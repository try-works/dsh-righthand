import { describe, it, expect, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guiTools, secretsTools } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

/** A stub webServer that captures registered routes and lets tests invoke them. */
function stubWebServer() {
  const routes = new Map<string, any>()
  const invoke = async (path: string, method = 'GET', body?: unknown) => {
    const spec = routes.get(path)
    if (!spec) throw new Error('no route: ' + path)
    const res = {
      _code: 0, _body: '',
      writeHead(code: number, headers: Record<string, string>) { this._code = code },
      end(text: string) { this._body = text },
    } as any
    const req = {
      method,
      on: (ev: string, cb: any) => { if (ev === 'end' && method === 'GET') cb() },
    } as any
    if (method === 'POST') {
      req._body = JSON.stringify(body ?? {})
      req.on = (ev: string, cb: any) => { if (ev === 'data' && req._body.length > 0) { const chunk = req._body; req._body = ''; cb(Buffer.from(chunk)) } else if (ev === 'end') cb() }
    }
    await spec.handler(req, res)
    return { code: res._code, body: res._body === '' ? undefined : JSON.parse(res._body) }
  }
  return {
    register: (spec: any) => { routes.set(spec.path, spec); return () => routes.delete(spec.path) },
    invoke,
  }
}

describe('righthand gui routes', () => {
  it('state returns settings, store keys, tasks and events; mutations apply', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rh-gui-'))
    const web = stubWebServer()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
    await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
    await ctx.plugin(secretsTools)
    ;(ctx as any).provide('webServer', web)
    await ctx.plugin(guiTools)
    await new Promise(r2 => setTimeout(r2, 150))

    const state1 = await web.invoke('/righthand/state')
    expect(state1.code).toBe(200)
    expect(Array.isArray(state1.body.storeKeys)).toBe(true)
    expect(Array.isArray(state1.body.tasks)).toBe(true)
    expect(Array.isArray(state1.body.events)).toBe(true)
    expect(state1.body.settings).toBeTruthy()

    const put = await web.invoke('/righthand/store/put', 'POST', { key: 'gui:test', value: { hello: 1 } })
    expect(put.code).toBe(200)
    const state2 = await web.invoke('/righthand/state')
    expect(state2.body.storeKeys).toContain('gui:test')

    const del = await web.invoke('/righthand/store/delete', 'POST', { key: 'gui:test' })
    expect(del.code).toBe(200)
    expect(del.body.existed).toBe(true)
    const state3 = await web.invoke('/righthand/state')
    expect(state3.body.storeKeys).not.toContain('gui:test')
  })
})