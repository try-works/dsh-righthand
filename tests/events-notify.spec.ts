import { describe, it, expect, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eventsTools, notifyTools, freeSlots } from '../src/index.ts'
import type { Event } from '../src/index.ts'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8' }] }))

const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ callId: ('t-' + name) as any, name, arguments: args, signal: new AbortController().signal })
}

async function boot(tmp: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(tmp, '.credentials.yaml'), watch: false })
  await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
  await ctx.plugin(eventsTools)
  await ctx.plugin(notifyTools)
  return ctx
}

describe('freeSlots (pure, local-time working hours)', () => {
  it('finds a gap between busy events inside working hours', () => {
    const now = new Date(2026, 7, 31, 8, 0)
    const at = (h: number) => new Date(2026, 7, 31, h, 0).toISOString()
    const busy: Event[] = [
      { id: 'e1', title: 'a', detail: '', at: at(12), state: 'pending', createdAt: '' },
      { id: 'e2', title: 'b', detail: '', at: at(15), state: 'pending', createdAt: '' },
      { id: 'e3', title: 'cancelled', detail: '', at: at(13), state: 'cancelled', createdAt: '' },
    ]
    const slots = freeSlots(busy, now, 60, 24)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0]).toBe(new Date(2026, 7, 31, 9, 0).toISOString())
  })

  it('respects the duration requirement', () => {
    const now = new Date(2026, 7, 31, 11, 0)
    const at = new Date(2026, 7, 31, 12, 0).toISOString()
    const busy: Event[] = [{ id: 'e1', title: 'a', detail: '', at, state: 'pending', createdAt: '' }]
    // 120 min does not fit before the 12:00 event, but the afternoon after
    // it is free - the trailing gap is a slot (live-caught bug fix).
    expect(freeSlots(busy, now, 120, 24)).toEqual([
      new Date(2026, 7, 31, 12, 0).toISOString(),
      new Date(2026, 8, 1, 9, 0).toISOString(),
    ])
    expect(freeSlots(busy, now, 30, 24)[0]).toBe(new Date(2026, 7, 31, 11, 0).toISOString())
  })

  it('an empty calendar yields slots (live-caught: returned [] before the fix)', () => {
    const now = new Date(2026, 7, 31, 10, 0)
    const slots = freeSlots([], now, 60, 24)
    expect(slots).toEqual([
      new Date(2026, 7, 31, 10, 0).toISOString(),
      new Date(2026, 8, 1, 9, 0).toISOString(),
    ])
  })

  it('the gap after the last event of a day is free time', () => {
    const now = new Date(2026, 7, 31, 9, 0)
    const at = new Date(2026, 7, 31, 10, 0).toISOString()
    const busy: Event[] = [{ id: 'e1', title: 'a', detail: '', at, state: 'pending', createdAt: '' }]
    const slots = freeSlots(busy, now, 60, 24)
    expect(slots[0]).toBe(new Date(2026, 7, 31, 9, 0).toISOString())
    expect(slots[1]).toBe(new Date(2026, 7, 31, 10, 0).toISOString())
  })
})


describe('rh_events_* tools', () => {
  it('due delivers once: pending to notified, never repeated', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-events-')))
    const past = new Date(Date.now() - 60000).toISOString()
    const c = await call(ctx, 'rh_events_create', { title: 'standup', at: past })
    expect(c.isError).toBe(false)
    const id = (c.value as any).id

    const due1 = await call(ctx, 'rh_events_due', {})
    expect((due1.value as any).due.length).toBe(1)
    expect((due1.value as any).due[0].title).toBe('standup')

    const due2 = await call(ctx, 'rh_events_due', {})
    expect((due2.value as any).due.length).toBe(0)

    const list = await call(ctx, 'rh_events_list', { state: 'notified' })
    expect((list.value as any).length).toBe(1)
    expect(id).toBeTruthy()
  })

  it('cancel keeps the record and reports existence', async () => {
    const ctx = await boot(await mkdtemp(join(tmpdir(), 'rh-events2-')))
    const c = await call(ctx, 'rh_events_create', { title: 'meeting', at: new Date(Date.now() + 3600000).toISOString() })
    const id = (c.value as any).id
    const cancel = await call(ctx, 'rh_events_cancel', { id })
    expect((cancel.value as any).existed).toBe(true)
    const cancel2 = await call(ctx, 'rh_events_cancel', { id })
    expect((cancel2.value as any).existed).toBe(true)
    const list = await call(ctx, 'rh_events_list', { state: 'cancelled' })
    expect((list.value as any).length).toBe(1)
  })
})

describe('rh_notify_send (stubbed network)', () => {
  it('POSTs to the topic with title, priority and TTL', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rh-notify-'))
    let captured: any
    vi.stubGlobal('fetch', (async (url: any, init: any) => {
      captured = { url: String(url), init }
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(FileSettingsProvider, { path: join(tmp, 'settings.yaml'), watch: false })
    await ctx.plugin(notifyTools)

    const r = await call(ctx, 'rh_notify_send', { topic: 'my-topic', message: 'build done', title: 'CI', priority: 3 })
    expect(r.isError).toBe(false)
    expect(captured.url).toBe('https://ntfy.sh/my-topic')
    expect(captured.init.method).toBe('POST')
    expect(captured.init.body).toBe('build done')
    expect(captured.init.headers.Title).toBe('CI')
    expect(captured.init.headers.Priority).toBe('3')
  })
})


