/**
 * permissions.golden — the guard facts of every rh_* tool, recorded.
 *
 * A safety net for changing the guard model, not a description of it
 * (the Mu pattern). The test below boots the real services and derives
 * each rh_* tool's facts from a canonical ruleset through the SAME
 * guardFactsFor the enforcement hook uses. If a refactor is
 * behaviour-preserving the golden does not change; if it does, the diff
 * is the list of doors that moved.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { storeTools, secretsTools, execTools, taskTools, textTools, weatherTools, placesTools, filesTools, eventsTools, notifyTools, guardTools, guardFactsFor } from '../src/index.ts'
import type { GuardRule } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'permissions.golden')

/** Stub LLM adapter for the text family's llm inject. */
class StubAdapter extends LlmAdapter {
  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = '{"ok":true}'
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* () { for (const c of chunks) yield c })()
  }
}

/** The canonical ruleset the golden derives against. Exercises every mode + the destructive flag. */
const CANONICAL_RULES: GuardRule[] = [
  { toolPrefix: 'rh_store_delete', mode: 'deny', destructive: true },
  { toolPrefix: 'rh_credential_set', mode: 'ask', destructive: true, ask: () => true },
  // Prefix semantics: this also matches rh_run_bg — the golden records both,
  // so changing that behaviour later is a visible golden diff, not a surprise.
  { toolPrefix: 'rh_run', mode: 'allow' },
]

function formatLines(names: readonly string[]): string[] {
  return names.map(n => {
    const facts = guardFactsFor(n, CANONICAL_RULES)
    return n.padEnd(28) + 'destructive=' + facts.destructive + ' mode=' + facts.mode
  })
}

async function boot(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  const tmp = await mkdtemp(join(tmpdir(), 'rh-golden-'))
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
  await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['rt-test'], new StubAdapter())
  await ctx.plugin(storeTools)
  await ctx.plugin(secretsTools)
  await ctx.plugin(execTools)
  await ctx.plugin(taskTools)
  await ctx.plugin(textTools, { provider: 'rt-test', model: 'stub' })
  await ctx.plugin(weatherTools)
  await ctx.plugin(placesTools)
  await ctx.plugin(filesTools)
  await ctx.plugin(eventsTools)
  await ctx.plugin(notifyTools)
  await ctx.plugin(guardTools, { rules: CANONICAL_RULES })
  return ctx
}

/** The rh_* tool names this plugin registers, from the live registry. */
async function rhToolNames(ctx: Context): Promise<string[]> {
  return ctx.tools.schemas()
    .map(s => s.name)
    .filter(n => n.startsWith('rh_'))
    .sort()
}

describe('permissions.golden', () => {
  it('every rh_* tool has the recorded guard facts', async () => {
    const ctx = await boot()
    const names = await rhToolNames(ctx)
    expect(names.length).toBeGreaterThan(0)
    const actual = formatLines(names).join('\n') + '\n'
    if (process.env.UPDATE_GOLDEN === '1') {
      await writeFile(GOLDEN, actual, 'utf8')
      return
    }
    const recorded = await readFile(GOLDEN, 'utf8')
    expect(actual).toBe(recorded)
  })
})
