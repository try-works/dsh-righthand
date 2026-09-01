/**
 * gui.ts - the righthand GUI host half: HTTP routes under /righthand/* on
 * the DSH web server that read and mutate the same domains the tools use.
 * The client half (src/client/index.ts) renders these as a panel inside the
 * DSH Web GUI. Mounts only when a webServer exists (the Web surface);
 * elsewhere the child fiber simply does not start.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { storeDomain } from './store-tools.ts'
import { taskDomain } from './task-tools.ts'
import { eventsDomain } from './events-tools.ts'
// Type-only: activates the cordis Context merge for ctx.webServer.
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'righthand-gui'
export const inject = ['webServer', 'storageDomain', 'settings']

const ns = settingsNamespace('righthand')

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (c: Buffer) => {
      bytes += c.length
      if (bytes > 65536) { reject(new Error('body too large')); req.destroy() }
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx: Context): void {
  let domains: { store: any; tasks: any; events: any } | undefined
  let ready: Promise<void> | undefined

  ctx.effect(() => {
    ready = (async () => {
      const [store, tasks, events] = await Promise.all([
        ctx.storageDomain.open(storeDomain),
        ctx.storageDomain.open(taskDomain),
        ctx.storageDomain.open(eventsDomain),
      ])
      domains = { store, tasks, events }
    })()
    return () => { }
  })

  const ensure = async (): Promise<NonNullable<typeof domains>> => {
    if (domains === undefined) { await ready }
    if (domains === undefined) throw new Error('righthand domains not open')
    return domains
  }

  const getSettings = () => {
    const v = ctx.settings.get(ns) as Record<string, unknown> | undefined
    return v ?? {}
  }

  const disposers: Array<() => void> = []
  ctx.effect(() => () => { for (const d of disposers.splice(0)) d() })

  const route = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    disposers.push(ctx.webServer.register({ kind: 'exact', path, handler }))
  }

  route('/righthand/state', async (_req, res) => {
    try {
      const d = await ensure()
      const storeKeys = [...d.store.table('rows').keys()]
      const tasks = [...d.tasks.table('tasks').entries()]
      const events = [...d.events.table('events').entries()]
      json(res, 200, {
        settings: getSettings(),
        storeKeys,
        tasks: tasks.map(([id, row]) => ({ id, ...row })),
        events: events.map(([id, row]) => ({ id, ...row })),
      })
    } catch (e) {
      json(res, 500, { error: String(e) })
    }
  })

  route('/righthand/settings/set', async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req))
      await ctx.settings.update(ns, body.patch)
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 400, { error: String(e) })
    }
  })

  route('/righthand/store/put', async (req, res) => {
    try {
      const d = await ensure()
      const body = JSON.parse(await readBody(req))
      if (typeof body.key !== 'string' || body.key === '') throw new Error('key required')
      await d.store.table('rows').put(body.key, { value: body.value ?? null, updatedAt: new Date().toISOString() })
      const writes = d.store.global.get()
      await d.store.global.set({ writes: writes.writes + 1 })
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 400, { error: String(e) })
    }
  })

  route('/righthand/store/delete', async (req, res) => {
    try {
      const d = await ensure()
      const body = JSON.parse(await readBody(req))
      const existed = await d.store.table('rows').delete(body.key)
      json(res, 200, { ok: true, existed })
    } catch (e) {
      json(res, 400, { error: String(e) })
    }
  })

  route('/righthand/task/update', async (req, res) => {
    try {
      const d = await ensure()
      const body = JSON.parse(await readBody(req))
      const row = await d.tasks.table('tasks').get(body.id)
      if (row === undefined) { json(res, 404, { error: 'task not found' }); return }
      const next: any = { ...row }
      if (typeof body.state === 'string') next.state = body.state
      if (body.result !== undefined) next.result = body.result
      await d.tasks.table('tasks').put(body.id, next)
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 400, { error: String(e) })
    }
  })

  route('/righthand/event/cancel', async (req, res) => {
    try {
      const d = await ensure()
      const body = JSON.parse(await readBody(req))
      const row = await d.events.table('events').get(body.id)
      if (row === undefined) { json(res, 404, { error: 'event not found' }); return }
      await d.events.table('events').put(body.id, { ...row, state: 'cancelled' })
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 400, { error: String(e) })
    }
  })
}