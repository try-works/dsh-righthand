/**
 * store-tools — DSH-native tools over ctx.storageDomain (domain KV).
 * A generic, schema-validated key-value store surface the righthand plugin
 * can reuse for its tool catalog, plus any other plugin needing durable state.
 * Built on the harness's own storage domain facility, not a hand-rolled file.
 * @module dsh-righthand/store-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'righthand-store'
export const inject = ['tools', 'storageDomain']

/** A value that JSON.stringify can carry (objects, arrays, scalars — no functions/symbols). */
export type JsonLike = unknown

/** One stored record: a string key → JSON value, with a write timestamp. */
export interface StoreRow {
  value: JsonLike
  updatedAt: string
}

/** Domain spec: the catalog table + a global singleton (write counter). */
export const storeDomain = defineDomain({
  name: 'righthand_store',
  version: 1,
  tables: {
    rows: domainTable(z.object({
      value: z.unknown(),
      updatedAt: z.string(),
    })),
  },
  global: {
    schema: z.object({ writes: z.number() }),
    initial: { writes: 0 },
  },
})

export type StoreDomain = Domain<typeof storeDomain>

/** Persisted store with typed read/write over the domain tables. */
export class KeyValueStore {
  constructor(private readonly domain: StoreDomain) {}

  async get(key: string): Promise<StoreRow | undefined> {
    return this.domain.table('rows').get(key) as StoreRow | undefined
  }

  async put(key: string, value: JsonLike): Promise<StoreRow> {
    const row: StoreRow = { value, updatedAt: new Date().toISOString() }
    await this.domain.table('rows').put(key, row)
    const writes = this.domain.global.get()
    await this.domain.global.set({ writes: writes.writes + 1 })
    return row
  }

  async delete(key: string): Promise<boolean> {
    return this.domain.table('rows').delete(key)
  }

  async list(): Promise<string[]> {
    return [...this.domain.table('rows').keys()]
  }

  async writes(): Promise<number> {
    return this.domain.global.get().writes
  }
}

/** Open the store on the mounted domain facility and register the model-facing tools. */
export function apply(ctx: Context): void {
  let store: KeyValueStore | undefined
  let ready: Promise<void> | undefined

  // Open the domain asynchronously (the facility may still be activating).
  ctx.effect(() => {
    ready = (async () => {
      const domain = await ctx.storageDomain.open(storeDomain)
      store = new KeyValueStore(domain)
    })()
    return () => { /* domain facility owns the domain; closing happens at unmount */ }
  })

  const ensure = async (): Promise<KeyValueStore> => {
    if (store === undefined) { await ready; }
    if (store === undefined) throw new Error('righthand store is not open (storageDomain not mounted)')
    return store
  }

  ctx.tools.register(defineTool({
    name: 'rh_store_put',
    description: 'Durably store a JSON value under a string key in the righthand KV store. Returns the stored record with a timestamp.',
    parameters: {
      key: { type: 'string', required: true, description: 'String key for the record.' },
      value: { type: 'json', required: true, description: 'Any JSON value to store (object, array, string, number, boolean, null).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
          writes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `stored ${value.key} (writes=${value.writes})` }],
    },
    presentCall: (args: any): ToolCallView => ({ card: 'generic', title: 'Store ' + args.key, kind: 'edit' }),
    presentResult: (_args, result): ToolResultView => ({ card: 'generic', content: result.content }),
    async execute(args) {
      const s = await ensure()
      const row = await s.put(args.key, args.value)
      return { key: args.key, updatedAt: row.updatedAt, writes: await s.writes() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_store_get',
    description: 'Read a stored JSON value by key. Returns null when the key is absent.',
    parameters: {
      key: { type: 'string', required: true, description: 'String key to read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          key: { type: 'string', required: true },
          value: { type: 'json' },
          updatedAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.found ? `${value.key} = ${JSON.stringify(value.value)}` : `${value.key} (absent)` }],
    },
    presentCall: (args: any): ToolCallView => ({ card: 'generic', title: 'Read ' + args.key, kind: 'read' }),
    presentResult: (_args, result): ToolResultView => ({ card: 'generic', content: result.content }),
    async execute(args) {
      const s = await ensure()
      const row = await s.get(args.key)
      if (row === undefined) return { found: false, key: args.key }
      return { found: true, key: args.key, value: row.value as any, updatedAt: row.updatedAt }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_store_delete',
    description: 'Delete a stored record by key. Returns whether it existed.',
    parameters: {
      key: { type: 'string', required: true, description: 'String key to delete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          existed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `deleted ${value.key}: ${value.existed}` }],
    },
    presentCall: (args: any): ToolCallView => ({ card: 'generic', title: 'Delete ' + args.key, kind: 'delete' }),
    presentResult: (_args, result): ToolResultView => ({ card: 'generic', content: result.content }),
    async execute(args) {
      const s = await ensure()
      const existed = await s.delete(args.key)
      return { key: args.key, existed }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_store_list',
    description: 'List all keys currently in the righthand KV store.',
    parameters: {},
    output: {
      schema: { type: 'array', items: { type: 'string' } },
      render: (_args, keys) => [{ type: 'text', text: keys.length === 0 ? '(empty)' : keys.join('\n') }],
    },
    presentCall: (): ToolCallView => ({ card: 'generic', title: 'List store keys', kind: 'read' }),
    presentResult: (_args, result): ToolResultView => ({ card: 'generic', content: result.content }),
    async execute() {
      const s = await ensure()
      return s.list()
    },
  }))
}