/**
 * events-tools — rh_events_* over ctx.storageDomain.
 * Reminders and the free-slot query. The agent IS the scheduler:
 * rh_events_due is the check the agent runs each turn — an event whose
 * time has come is returned once (pending → notified), so a missed run
 * cannot go quiet without a record. Repeating events are one-off here;
 * a real scheduler is the documented Cloudflare cron escalation.
 * @module dsh-righthand/events-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'righthand-events'
export const inject = ['tools', 'storageDomain']

export interface Event {
  id: string
  title: string
  detail: string
  at: string
  state: 'pending' | 'notified' | 'cancelled',
  createdAt: string
}

export const eventsDomain = defineDomain({
  name: 'righthand_events',
  version: 1,
  tables: {
    events: domainTable(z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      at: z.string(),
      state: z.enum(['pending', 'notified', 'cancelled']),
      createdAt: z.string(),
    })),
  },
})

export type EventsDomain = Domain<typeof eventsDomain>

function newId(): string {
  return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

/**
 * Free slots: gaps of at least durationMinutes between pending events at or
 * after now, within working hours 09:00–17:00, over the next horizonHours.
 * Pure and exported for tests.
 */
export function freeSlots(events: readonly Event[], now: Date, durationMinutes: number, horizonHours = 24): string[] {
  const horizonEnd = now.getTime() + horizonHours * 3600000
  const busy = events
    .filter(e => e.state === 'pending')
    .map(e => new Date(e.at).getTime())
    .filter(t => Number.isFinite(t) && t >= now.getTime() && t <= horizonEnd)
    .sort((a, b) => a - b)
  const slots: string[] = []
  const need = durationMinutes * 60000
  const dayStart = (t: number): number => {
    const d = new Date(t)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }
  const dayEnd = (t: number): number => {
    const d = new Date(t)
    d.setHours(17, 0, 0, 0)
    return d.getTime()
  }
  // Scan each working day in the horizon. A slot is any gap of at least
  // `need` between blockers (pending events and the end of the day).
  // An empty calendar is the common case: it must yield slots, and the
  // gap after the last event of a day is free time too.
  for (let day = dayStart(now.getTime()); day <= horizonEnd; day += 86400000) {
    const wStart = day
    const wEnd = dayEnd(day)
    if (wEnd <= now.getTime()) continue
    let cursor = Math.max(wStart, now.getTime())
    const to = Math.min(wEnd, horizonEnd)
    const blockers = busy.filter(t => t > cursor && t < to)
    for (const b of [...blockers, to]) {
      if (b - cursor >= need) {
        slots.push(new Date(cursor).toISOString())
      }
      cursor = Math.max(cursor, b)
    }
  }
  return slots
}

export function apply(ctx: Context): void {
  let domain: EventsDomain | undefined
  let ready: Promise<void> | undefined

  ctx.effect(() => {
    ready = (async () => {
      domain = await ctx.storageDomain.open(eventsDomain)
    })()
    return () => { /* domain facility owns the domain */ }
  })

  const ensure = async (): Promise<EventsDomain> => {
    if (domain === undefined) { await ready; }
    if (domain === undefined) throw new Error('righthand events are not open (storageDomain not mounted)')
    return domain
  }

  const all = async (): Promise<Event[]> => {
    const d = await ensure()
    return [...d.table('events').entries()].map(([, e]) => e)
  }

  ctx.tools.register(defineTool({
    name: 'rh_events_create',
    description: 'Schedule a reminder at an ISO datetime. One-off: the agent checks rh_events_due each turn and the event is delivered exactly once (pending to notified), so a missed run is never silently dropped.',
    parameters: {
      title: { type: 'string', required: true, description: 'What to be reminded of.' },
      at: { type: 'string', required: true, description: 'ISO datetime when it is due, e.g. 2026-08-31T09:00:00Z.' },
      detail: { type: 'string', description: 'Optional longer note.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          at: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'event ' + value.id + ': ' + value.title + ' at ' + value.at }],
    },
    async execute(args) {
      const d = await ensure()
      const at = new Date(args.at)
      if (Number.isNaN(at.getTime())) throw new Error('at must be a valid ISO datetime')
      const event: Event = {
        id: newId(),
        title: args.title.trim(),
        detail: args.detail ?? '',
        at: at.toISOString(),
        state: 'pending',
        createdAt: new Date().toISOString(),
      }
      if (event.title === '') throw new Error('an event needs a title')
      await d.table('events').put(event.id, event)
      return { id: event.id, title: event.title, at: event.at }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_events_due',
    description: 'The pending events whose time has come (at <= now). Each is delivered exactly once: returned events are marked notified. This is the check to run every turn — the agent is the scheduler.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          due: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.due.length === 0 ? '(nothing due)' : value.due.map((e: any) => e.title + ' at ' + e.at).join(' / ') }],
    },
    async execute() {
      const d = await ensure()
      const now = Date.now()
      const due: Event[] = []
      for (const e of [...d.table('events').entries()].map(([, v]) => v)) {
        if (e.state === 'pending' && new Date(e.at).getTime() <= now) {
          const notified: Event = { ...e, state: 'notified' }
          await d.table('events').put(e.id, notified)
          due.push(notified)
        }
      }
      due.sort((a, b) => a.at.localeCompare(b.at))
      return { due: due.map(e => ({ id: e.id, title: e.title, detail: e.detail, at: e.at })) as any[] }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_events_list',
    description: 'List events: upcoming pending ones first, then notified and cancelled.',
    parameters: {
      state: { type: 'string', description: 'Filter: pending | notified | cancelled. Omit for all.' },
    },
    output: {
      schema: { type: 'array', items: { type: 'json' } },
      render: (_args, value) => [{ type: 'text', text: value.length === 0 ? '(no events)' : (value as any[]).map((e: any) => e.at + ' ' + e.title + ' [' + e.state + ']').join(' / ') }],
    },
    async execute(args) {
      const events = await all()
      const wanted = args.state ?? null
      const filtered = wanted ? events.filter(e => e.state === wanted) : events
      const rank = { pending: 0, notified: 1, cancelled: 2 } as Record<string, number>
      filtered.sort((a, b) => (rank[a.state] - rank[b.state]) || a.at.localeCompare(b.at))
      return filtered.map(e => ({ id: e.id, title: e.title, detail: e.detail, at: e.at, state: e.state })) as any[]
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_events_free',
    description: 'When is there nothing booked: the next free slots of at least durationMinutes within working hours (09:00-17:00) over the next horizonHours.',
    parameters: {
      durationMinutes: { type: 'integer', required: true, description: 'How long the free block must be.' },
      horizonHours: { type: 'integer', description: 'How far ahead to look (default 24).' },
    },
    output: {
      schema: { type: 'array', items: { type: 'string' } },
      render: (_args, value) => [{ type: 'text', text: value.length === 0 ? '(no free slot)' : (value as string[]).join(' / ') }],
    },
    async execute(args) {
      const events = await all()
      return freeSlots(events, new Date(), args.durationMinutes, args.horizonHours ?? 24)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_events_cancel',
    description: 'Cancel an event by id. Returns whether it existed. Cancelled events stay in the record — a cancellation is news too.',
    parameters: {
      id: { type: 'string', required: true, description: 'The event id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          existed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'cancelled ' + value.id + ': ' + value.existed }],
    },
    async execute(args) {
      const d = await ensure()
      const e = d.table('events').get(args.id)
      if (e === undefined) return { id: args.id, existed: false }
      await d.table('events').put(args.id, { ...e, state: 'cancelled' })
      return { id: args.id, existed: true }
    },
  }))
}



