/**
 * files-tools — rh_files_* over Cloudflare R2 (the user's own account).
 * The first family on an actual Cloudflare primitive. S3-compatible API,
 * signed with SigV4 (src/sigv4.ts, pinned to the AWS test vector).
 *
 * Credentials resolve at call time from the credential provider
 * (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY); accountId and bucket come
 * from the righthand settings namespace. The client is a pure factory so
 * tests drive it with a stubbed fetch.
 * @module dsh-righthand/files-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { signRequest, presignGet } from './sigv4.ts'

export const name = 'righthand-files'
export const inject = ['tools', 'credentials', 'settings']

export const R2_ACCESS_KEY_REF = 'R2_ACCESS_KEY_ID'
export const R2_SECRET_KEY_REF = 'R2_SECRET_ACCESS_KEY'

export interface FilesConfig {
  /** Bucket name; defaults to the righthand settings defaultR2Bucket. */
  bucket?: string
}

export interface R2Options {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  fetchImpl?: typeof fetch
  now?: () => Date
}

function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export interface ListEntry {
  key: string
  size: number
  lastModified: string
}

/** Minimal ListObjectsV2 XML parse: Key / Size / LastModified triples. */
function parseListXml(xml: string): ListEntry[] {
  const out: ListEntry[] = []
  const contents = xml.split('<Contents>').slice(1)
  for (const block of contents) {
    const grab = (tag: string): string => {
      const a = block.indexOf('<' + tag + '>')
      const b = block.indexOf('</' + tag + '>')
      return a < 0 || b < 0 ? '' : block.slice(a + tag.length + 2, b)
    }
    const key = grab('Key')
    if (key === '') continue
    out.push({ key, size: Number(grab('Size') ?? 0), lastModified: grab('LastModified') })
  }
  return out
}

/**
 * The R2 client factory. Pure over its options; every call signs fresh.
 */
export function createR2Client(opts: R2Options) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())
  const base = 'https://' + opts.accountId + '.r2.cloudflarestorage.com/' + opts.bucket

  async function request(method: string, key: string, payload: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const url = base + '/' + key
    const parsed = new URL(url)
    const signed = signRequest({
      method,
      url,
      headers: { host: parsed.host, ...extraHeaders },
      payload,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: 'auto',
      amzDate: amzDate(now()),
    })
    return fetchImpl(url, { method, headers: signed.headers, body: payload === '' ? undefined : payload })
  }

  return {
    async put(key: string, content: string, contentType?: string): Promise<{ key: string; size: number }> {
      const res = await request('PUT', key, content, contentType ? { 'content-type': contentType } : {})
      if (!res.ok) throw new Error('R2 PUT failed: HTTP ' + res.status)
      return { key, size: Buffer.byteLength(content) }
    },

    async get(key: string): Promise<{ found: boolean; content: string; contentType: string }> {
      const res = await request('GET', key, '')
      if (res.status === 404) return { found: false, content: '', contentType: '' }
      if (!res.ok) throw new Error('R2 GET failed: HTTP ' + res.status)
      return { found: true, content: await res.text(), contentType: res.headers.get('content-type') ?? '' }
    },

    async list(prefix?: string, maxKeys?: number): Promise<ListEntry[]> {
      const q = '?list-type=2' + (prefix ? '&prefix=' + encodeURIComponent(prefix) : '') + (maxKeys ? '&max-keys=' + maxKeys : '')
      const url = base + '/' + q
      const parsed = new URL(url)
      const signed = signRequest({
        method: 'GET',
        url,
        headers: { host: parsed.host },
        payload: '',
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        region: 'auto',
        amzDate: amzDate(now()),
      })
      const res = await fetchImpl(url, { method: 'GET', headers: signed.headers })
      if (!res.ok) throw new Error('R2 list failed: HTTP ' + res.status)
      return parseListXml(await res.text())
    },

    share(key: string, expiresSeconds: number): string {
      return presignGet({
        url: base + '/' + key,
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        region: 'auto',
        amzDate: amzDate(now()),
        expiresSeconds,
      })
    },

    async delete(key: string): Promise<{ key: string; existed: boolean }> {
      const res = await request('DELETE', key, '')
      if (res.status === 404) return { key, existed: false }
      if (!res.ok) throw new Error('R2 DELETE failed: HTTP ' + res.status)
      return { key, existed: true }
    },
  }
}


export function apply(ctx: Context, config: FilesConfig = {}): void {
  const ns = settingsNamespace('righthand')

  /** Resolve accountId + credentials + bucket at call time. */
  async function client(): Promise<ReturnType<typeof createR2Client>> {
    const settings = ctx.settings.get(ns) as { accountId?: string; defaultR2Bucket?: string } | undefined
    const accountId = settings?.accountId ?? ''
    if (accountId === '') throw new Error('righthand accountId is not set (rh_settings_set { accountId })')
    const bucket = config.bucket ?? settings?.defaultR2Bucket ?? ''
    if (bucket === '') throw new Error('R2 bucket is not set (plugin config bucket or settings defaultR2Bucket)')
    const access = await ctx.credentials.resolve(credentialRef(R2_ACCESS_KEY_REF))
    const secret = await ctx.credentials.resolve(credentialRef(R2_SECRET_KEY_REF))
    if (access === undefined || secret === undefined) {
      throw new Error('R2 credentials are not set (rh_credential_set R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)')
    }
    return createR2Client({ accountId, accessKeyId: access.value, secretAccessKey: secret.value, bucket })
  }

  ctx.tools.register(defineTool({
    name: 'rh_files_put',
    description: 'Store a file in the R2 bucket and return its key. Content is text (reports, CSV, transcripts, code); content type defaults to text/plain.',
    parameters: {
      key: { type: 'string', required: true, description: 'Object key, e.g. reports/2026-08-30.csv.' },
      content: { type: 'string', required: true, description: 'The full text content to store.' },
      contentType: { type: 'string', description: 'Content type, e.g. text/csv. Defaults to text/plain.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          size: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'stored ' + value.key + ' (' + value.size + ' bytes)' }],
    },
    async execute(args) {
      const c = await client()
      return c.put(args.key, args.content, args.contentType)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_files_get',
    description: 'Read a stored file back by its key. found: false means the key is absent, not an error.',
    parameters: {
      key: { type: 'string', required: true, description: 'The object key to read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          key: { type: 'string', required: true },
          content: { type: 'string' },
          contentType: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.found && typeof value.content === 'string' ? value.content : '(absent)' }],
    },
    async execute(args) {
      const c = await client()
      const out = await c.get(args.key)
      return {
        key: args.key,
        found: out.found,
        ...out.found ? { content: out.content, contentType: out.contentType } : {},
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_files_list',
    description: 'List objects in the bucket, optionally by key prefix. Newest first is not guaranteed by S3; entries carry lastModified.',
    parameters: {
      prefix: { type: 'string', description: 'Only keys starting with this, e.g. reports/.' },
      maxKeys: { type: 'integer', description: 'Max entries (default 100).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.entries.length + ' objects' }],
    },
    async execute(args) {
      const c = await client()
      const entries = await c.list(args.prefix, args.maxKeys)
      return { entries: entries as any[] }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_files_share',
    description: 'Get a presigned download URL for a key, valid for the given minutes (default 60, max 10080). Anyone with the URL can read the object for that window.',
    parameters: {
      key: { type: 'string', required: true, description: 'The object key to share.' },
      minutes: { type: 'integer', description: 'Validity in minutes (default 60, max 10080 = 7 days).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          url: { type: 'string', required: true },
          expiresAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.url }],
    },
    async execute(args) {
      const minutes = Math.min(Math.max(args.minutes ?? 60, 1), 10080)
      const c = await client()
      const url = c.share(args.key, minutes * 60)
      return { key: args.key, url, expiresAt: new Date(Date.now() + minutes * 60000).toISOString() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_files_delete',
    description: 'Delete an object by key. Returns whether it existed.',
    parameters: {
      key: { type: 'string', required: true, description: 'The object key to delete.' },
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
      render: (_args, value) => [{ type: 'text', text: 'deleted ' + value.key + ': ' + value.existed }],
    },
    async execute(args) {
      const c = await client()
      return c.delete(args.key)
    },
  }))
}




