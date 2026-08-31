/**
 * secrets-tools — DSH-native tools over ctx.credentials + ctx.settings.
 * The righthand plugin's auth surface: declare a credential reference,
 * describe it (never the value), set/unset through the provider, and read
 * plugin settings from a registered namespace (redacted).
 * Built on the harness's own seams, not a hand-rolled secret store.
 * @module dsh-righthand/secrets-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'righthand-secrets'
export const inject = ['tools', 'credentials', 'settings']

/** righthand plugin settings namespace schema. */
export interface RighthandSettings {
  accountId: string
  defaultScriptPrefix: string
  defaultZone: string
}

export const righthandSettingsSchema = z.object({
  accountId: z.string().default(''),
  defaultScriptPrefix: z.string().default('rh-'),
  defaultZone: z.string().default(''),
  defaultR2Bucket: z.string().default(''),
})

/** Register the settings namespace + the secret/credential tools. */
export function apply(ctx: Context): void {
  const ns = settingsNamespace('righthand')
  // Register once; the settings provider merges schema defaults + user doc.
  const scope = ctx.settings.register(ns, righthandSettingsSchema)

  ctx.tools.register(defineTool({
    name: 'rh_credential_describe',
    description: 'Report whether a credential reference is configured (and from which source layer), without ever returning the secret value. Use this to check auth state before a deploy/invoke.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Credential reference, e.g. CLOUDFLARE_API_TOKEN.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          configured: { type: 'boolean', required: true },
          source: { type: 'string' },
          writable: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ref}: configured=${value.configured}${value.source ? ' (source=' + value.source + ')' : ''}, writable=${value.writable}` }],
    },
    async execute(args) {
      const ref = credentialRef(args.ref)
      const info = await ctx.credentials.describe(ref)
      return { ref: args.ref, configured: info.configured, ...info.source !== undefined ? { source: info.source } : {}, writable: info.writable }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_credential_set',
    description: 'Store a secret value for a credential reference through the harness credential provider. The value is written durably and never echoed back.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Credential reference to store, e.g. CLOUDFLARE_API_TOKEN.' },
      value: { type: 'string', required: true, description: 'The non-empty secret value to store.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          stored: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `stored credential ${value.ref} (value not echoed)` }],
    },
    async execute(args) {
      if (args.value.length === 0) throw new Error('credential value must be non-empty')
      await ctx.credentials.set(credentialRef(args.ref), args.value)
      return { ref: args.ref, stored: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_credential_unset',
    description: 'Remove a credential reference. Idempotent.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Credential reference to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          removed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `removed credential ${value.ref}` }],
    },
    async execute(args) {
      await ctx.credentials.unset(credentialRef(args.ref))
      return { ref: args.ref, removed: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_settings_get',
    description: 'Read the resolved righthand plugin settings (schema defaults + user overrides). Secret fields are redacted; use this to see effective account/zone/prefix configuration.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const v = scope.get()
      return { accountId: v.accountId, defaultScriptPrefix: v.defaultScriptPrefix, defaultZone: v.defaultZone, defaultR2Bucket: v.defaultR2Bucket }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_settings_set',
    description: 'Merge a partial patch into the righthand settings namespace (persisted by the harness settings provider).',
    parameters: {
      patch: { type: 'object', additionalProperties: true, required: true, description: 'Partial settings patch, e.g. { "accountId": "..." }.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          applied: { type: 'boolean', required: true },
        },
      },
      render: () => [{ type: 'text', text: 'settings updated' }],
    },
    async execute(args) {
      await scope.update(args.patch as Partial<RighthandSettings>)
      return { applied: true }
    },
  }))
}
