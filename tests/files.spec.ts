import { describe, it, expect, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { filesTools, secretsTools, createR2Client, signRequest } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ callId: ('t-' + name) as any, name, arguments: args, signal: new AbortController().signal })
}

describe('sigv4 (AWS published test vector)', () => {
  it('signs the documented S3 GET example', () => {
    const out = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
      payload: '',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    })
    expect(out.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(out.headers.authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

describe('createR2Client (stubbed fetch)', () => {
  const opts = {
    accountId: 'acct123',
    accessKeyId: 'AKID',
    secretAccessKey: 'SECRET',
    bucket: 'bkt',
    now: () => new Date('2026-08-30T12:00:00Z'),
  }

  it('put/get/delete round-trips and signs every request', async () => {
    const store = new Map<string, string>()
    const fetchImpl = (async (url: any, init: any) => {
      const u = String(url)
      const key = u.slice(u.indexOf('/bkt/') + 5)
      const auth = (init.headers as Record<string, string>).authorization
      expect(auth).toContain('AWS4-HMAC-SHA256')
      if (init.method === 'PUT') { store.set(key, init.body ?? ''); return new Response(null, { status: 200 }) }
      if (init.method === 'GET') { return store.has(key) ? new Response(store.get(key), { status: 200, headers: { 'content-type': 'text/plain' } }) : new Response(null, { status: 404 }) }
      if (init.method === 'DELETE') { const had = store.delete(key); return new Response(null, { status: had ? 204 : 404 }) }
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch
    const c = createR2Client({ ...opts, fetchImpl })

    const put = await c.put('reports/a.csv', 'a,b;1,2')
    expect(put.size).toBe(7)
    const got = await c.get('reports/a.csv')
    expect(got).toMatchObject({ found: true, content: 'a,b;1,2' })
    const missing = await c.get('nope')
    expect(missing.found).toBe(false)
    const del = await c.delete('reports/a.csv')
    expect(del.existed).toBe(true)
    expect((await c.delete('reports/a.csv')).existed).toBe(false)
  })

  it('lists objects and shares presigned URLs', async () => {
    const fetchImpl = (async (url: any) => new Response('<ListBucketResult><Contents><Key>a.txt</Key><Size>3</Size><LastModified>2026-08-30T12:00:00Z</LastModified></Contents></ListBucketResult>', { status: 200 })) as unknown as typeof fetch
    const c = createR2Client({ ...opts, fetchImpl })
    const entries = await c.list('a')
    expect(entries).toEqual([{ key: 'a.txt', size: 3, lastModified: '2026-08-30T12:00:00Z' }])
    const url = c.share('a.txt', 3600)
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-Signature=')
    expect(url).toContain('X-Amz-Expires=3600')
  })
})

describe('rh_files_* tools (booted, stubbed network)', () => {
  it('put/get round-trip resolves credentials + settings at call time', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rh-files-'))
    const store = new Map<string, string>()
    vi.stubGlobal('fetch', (async (url: any, init: any) => {
      const u = String(url)
      expect(u).toContain('acct123.r2.cloudflarestorage.com/bkt/')
      const key = u.slice(u.indexOf('/bkt/') + 5)
      if (init?.method === 'PUT') { store.set(key, init.body ?? ''); return new Response(null, { status: 200 }) }
      if (init?.method === 'GET') { return store.has(key) ? new Response(store.get(key), { status: 200 }) : new Response(null, { status: 404 }) }
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
    await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
    await ctx.plugin(secretsTools)
    await ctx.credentials.set(credentialRef('R2_ACCESS_KEY_ID'), 'AKID')
    await ctx.credentials.set(credentialRef('R2_SECRET_ACCESS_KEY'), 'SECRET')
    await ctx.settings.update(settingsNamespace('righthand'), { accountId: 'acct123', defaultR2Bucket: 'bkt' })
    await ctx.plugin(filesTools)

    const put = await call(ctx, 'rh_files_put', { key: 'notes/hello.txt', content: 'hello r2' })
    expect(put.isError).toBe(false)
    expect((put.value as any).size).toBe(8)
    const get = await call(ctx, 'rh_files_get', { key: 'notes/hello.txt' })
    expect((get.value as any).found).toBe(true)
    expect((get.value as any).content).toBe('hello r2')
  })
})
