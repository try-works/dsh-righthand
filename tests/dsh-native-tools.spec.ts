import { describe, it, expect, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { storeTools, secretsTools, execTools, taskTools, textTools, guardTools, apply, inject, name } from '../src/index.ts'

/** Stub LLM adapter: answers per system-prompt marker, deterministically. */
class StubAdapter extends LlmAdapter {
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sys = options.system ?? ''
    let text: string
    if (sys.includes('You summarise text')) text = 'This is a short summary.'
    else if (sys.includes('extract structured data')) text = '{"name":"Alice","age":30}'
    else if (sys.includes('You classify text')) text = '{"label":"bug","confidence":0.9}'
    else if (sys.includes('You translate text')) text = 'Hola mundo'
    else text = '{"ok":true}'
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* () { for (const c of chunks) yield c })()
  }
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

async function boot(tmp: string) {
  const ctx = new Context()
  contexts.push(ctx)
  // Real harness services (paper-design boot pattern + the providers my tools inject).
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['rt-test'], new StubAdapter())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
  await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(storeTools)
  await ctx.plugin(secretsTools)
  await ctx.plugin(execTools)
  await ctx.plugin(taskTools)
  await ctx.plugin(textTools, { provider: 'rt-test', model: 'stub' })
  await ctx.plugin(guardTools, { rules: [{ toolPrefix: 'rh_deny_', mode: 'deny' }] })
  return ctx
}

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ callId: ('t-' + name) as any, name, arguments: args, signal: new AbortController().signal })
}

async function bootCombined(tmp: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['rt-test'], new StubAdapter())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
  await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  // The combined entry: name/inject/apply from src/index.ts.
  await ctx.plugin({ name, inject, apply }, { rules: [{ toolPrefix: 'rh_deny_', mode: 'deny' }] })
  // Children mount without await, so poll until the store tool is registered.
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const probe = await ctx.tools.execute({ callId: ('t-probe') as any, name: 'rh_settings_get', arguments: {}, signal: new AbortController().signal })
    if (!probe.isError) return ctx
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('combined plugin children did not register within 5s')
}

describe('store-tools over ctx.storageDomain', () => {
  it('put/get/delete/list round-trips a JSON value durably', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-store-')))
    const put = await call(ctx, 'rh_store_put', { key: 'k1', value: { a: 1, b: [2, 3] } })
    expect(put.isError).toBe(false)
    expect(put.value).toMatchObject({ key: 'k1', writes: 1 })

    const get = await call(ctx, 'rh_store_get', { key: 'k1' })
    expect(get.value).toMatchObject({ found: true, value: { a: 1, b: [2, 3] } })

    const list = await call(ctx, 'rh_store_list', {})
    expect(list.value).toEqual(['k1'])

    const del = await call(ctx, 'rh_store_delete', { key: 'k1' })
    expect(del.value).toEqual({ key: 'k1', existed: true })

    const get2 = await call(ctx, 'rh_store_get', { key: 'k1' })
    expect(get2.value).toMatchObject({ found: false })
  })

  it('increments the global write counter', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-store2-')))
    await call(ctx, 'rh_store_put', { key: 'a', value: 1 })
    const put = await call(ctx, 'rh_store_put', { key: 'b', value: 2 })
    expect((put.value as any).writes).toBe(2)
  })
})

describe('secrets-tools over ctx.credentials + ctx.settings', () => {
  it('describe/set/describe/unset never echoes the secret value', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-secrets-')))
    const d1 = await call(ctx, 'rh_credential_describe', { ref: 'TEST_API_KEY' })
    expect(d1.value).toMatchObject({ ref: 'TEST_API_KEY', configured: false })

    const set = await call(ctx, 'rh_credential_set', { ref: 'TEST_API_KEY', value: 'hunter2-secret' })
    expect(set.isError).toBe(false)
    expect(set.value).toEqual({ ref: 'TEST_API_KEY', stored: true })
    expect(JSON.stringify(set.value)).not.toContain('hunter2-secret')

    const d2 = await call(ctx, 'rh_credential_describe', { ref: 'TEST_API_KEY' })
    expect(d2.value).toMatchObject({ ref: 'TEST_API_KEY', configured: true })
    expect(JSON.stringify(d2.value)).not.toContain('hunter2-secret')

    const unset = await call(ctx, 'rh_credential_unset', { ref: 'TEST_API_KEY' })
    expect(unset.value).toEqual({ ref: 'TEST_API_KEY', removed: true })
    const d3 = await call(ctx, 'rh_credential_describe', { ref: 'TEST_API_KEY' })
    expect(d3.value).toMatchObject({ configured: false })
  })

  it('settings register/read/update round-trips with schema defaults', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-settings-')))
    const g = await call(ctx, 'rh_settings_get', {})
    expect(g.value).toMatchObject({ defaultScriptPrefix: 'rh-', accountId: '' })

    await call(ctx, 'rh_settings_set', { patch: { accountId: '0bb0', defaultZone: 'ambiens.dev' } })
    const g2 = await call(ctx, 'rh_settings_get', {})
    expect(g2.value).toMatchObject({ accountId: '0bb0', defaultZone: 'ambiens.dev', defaultScriptPrefix: 'rh-' })
  })
})

describe('task-tools over ctx.storageDomain', () => {
  it('create/list/next/update/delete round-trips with the state machine', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-task-')))
    const a = await call(ctx, 'rh_task_create', { title: 'first task' })
    expect(a.isError).toBe(false)
    expect((a.value as any).state).toBe('open')
    const idA = (a.value as any).id

    const b = await call(ctx, 'rh_task_create', { title: 'second task', due: '2026-09-01' })
    const idB = (b.value as any).id

    // next = oldest open first
    const next = await call(ctx, 'rh_task_next', {})
    expect((next.value as any).id).toBe(idA)

    const list = await call(ctx, 'rh_task_list', {})
    expect((list.value as any).map((t: any) => t.state)).toEqual(['open', 'open'])

    // finish the first, fail the second with a recorded result
    await call(ctx, 'rh_task_update', { id: idA, state: 'done', result: 'shipped' })
    await call(ctx, 'rh_task_update', { id: idB, state: 'failed', result: 'build broke' })

    const next2 = await call(ctx, 'rh_task_next', {})
    expect((next2.value as any).found).toBe(false)

    const open = await call(ctx, 'rh_task_list', { state: 'open' })
    expect((open.value as any).length).toBe(0)
    const failed = await call(ctx, 'rh_task_list', { state: 'failed' })
    expect((failed.value as any)[0].title).toBe('second task')

    const del = await call(ctx, 'rh_task_delete', { id: idA })
    expect((del.value as any).existed).toBe(true)
    const del2 = await call(ctx, 'rh_task_delete', { id: idA })
    expect((del2.value as any).existed).toBe(false)
  })
})

describe('text-tools over ctx.llm', () => {
  it('summarise returns plain prose', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-text-sum-')))
    const r = await call(ctx, 'rh_text_summarise', { text: 'A long article about widgets. ' + 'It goes on for a while. '.repeat(20) })
    expect(r.isError).toBe(false)
    expect((r.value as any).summary).toBe('This is a short summary.')
  })

  it('extract returns JSON matching the caller schema', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-text-ext-')))
    const r = await call(ctx, 'rh_text_extract', {
      text: 'Alice, age 30, works at Acme.',
      schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name', 'age'] },
    })
    expect(r.isError).toBe(false)
    expect((r.value as any).extracted).toEqual({ name: 'Alice', age: 30 })
  })

  it('classify returns one of the given labels with confidence', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-text-cls-')))
    const r = await call(ctx, 'rh_text_classify', {
      text: 'the app crashes when I save',
      labels: ['bug', 'feature request', 'question'],
    })
    expect(r.isError).toBe(false)
    expect((r.value as any).label).toBe('bug')
    expect((r.value as any).confidence).toBe(0.9)
  })

  it('translate preserves prose', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-text-tr-')))
    const r = await call(ctx, 'rh_text_translate', { text: 'Hello world', language: 'Spanish' })
    expect(r.isError).toBe(false)
    expect((r.value as any).translation).toBe('Hola mundo')
  })
})

describe('exec-tools over ctx.subprocess + ctx.jobs', () => {
  it('rh_run executes node --version and returns exit 0 + stdout', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-exec-')))
    const r = await call(ctx, 'rh_run', { argv: ['node', '--version'] })
    expect(r.isError).toBe(false)
    expect((r.value as any).exitCode).toBe(0)
    expect(String((r.value as any).stdout)).toMatch(/v\d+/)
  })

  it('rh_run_bg starts a background job and it settles completed', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-execbg-')))
    const r = await call(ctx, 'rh_run_bg', { argv: ['node', '-e', 'console.log("bg-ok")'], label: 'bg test' })
    expect(r.isError).toBe(false)
    const jobId = (r.value as any).jobId
    expect(String(jobId)).toBeTruthy()
    const snapshot = await ctx.jobs.wait(jobId, 10000)
    expect(snapshot.status).toBe('completed')
  })
})

describe('guard-tools over ctx.tools pre-execute', () => {
  it('denies a tool matching the deny prefix', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-guard-')))
    // Register a throwaway tool under the denied prefix to prove the gate fires.
    ctx.tools.register({
      name: 'rh_deny_probe',
      description: 'probe',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'x' }] },
      execute: async () => 'ok',
    } as any)
    const r = await call(ctx, 'rh_deny_probe', {})
    expect(r.isError).toBe(true)
  })
})

describe('combined plugin entry (src/index.ts)', () => {
  it('apply mounts all four tool families as child fibers', async () => {
    const ctx = await bootCombined(await mkdtemp(join(tmpdir(), 'rh-combined-')))
    const put = await call(ctx, 'rh_store_put', { key: 'c1', value: { ok: true } })
    expect(put.isError).toBe(false)
    const get = await call(ctx, 'rh_store_get', { key: 'c1' })
    expect((get.value as any).found).toBe(true)
    const g = await call(ctx, 'rh_settings_get', {})
    expect((g.value as any).defaultScriptPrefix).toBe('rh-')
    const r = await call(ctx, 'rh_run', { argv: ['node', '--version'] })
    expect((r.value as any).exitCode).toBe(0)
    // Guard config reaches guard-tools through the combined config.
    ctx.tools.register({
      name: 'rh_deny_probe',
      description: 'probe',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'x' }] },
      execute: async () => 'ok',
    } as any)
    const denied = await call(ctx, 'rh_deny_probe', {})
    expect(denied.isError).toBe(true)
  })

  it('registers the packaged dsh-righthand skill', async () => {
    const ctx = await bootCombined(await mkdtemp(join(tmpdir(), 'rh-skill-')))
    const skills = await ctx.skills.list()
    const skill = skills.find(s => s.name === 'dsh-righthand')
    expect(skill).toBeDefined()
    expect(skill?.source).toBe('bundled')
    expect(skill?.description).toContain('righthand toolkit')
  })
})
