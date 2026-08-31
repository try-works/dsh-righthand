/**
 * notify-tools — rh_notify_send over ntfy.sh (keyless).
 * Interrupt yourself on your own devices: publish to a topic; any phone
 * subscribed to that topic gets it. The topic name is the only secret —
 * choose one nobody can guess, like the digest of a random string.
 * @module dsh-righthand/notify-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { guardedFetch } from './weather-tools.ts'

export const name = 'righthand-notify'
export const inject = ['tools', 'settings']

export interface NotifyConfig {
  /** ntfy server base URL; default https://ntfy.sh (keyless publish). */
  baseUrl?: string
  /** Topic to publish to; defaults to the righthand settings defaultNotifyTopic. */
  topic?: string
}

export function apply(ctx: Context, config: NotifyConfig = {}): void {
  const ns = settingsNamespace('righthand')
  const baseUrl = config.baseUrl ?? 'https://ntfy.sh'

  ctx.tools.register(defineTool({
    name: 'rh_notify_send',
    description: 'Interrupt yourself on your own devices: publish a notification to a ntfy.sh topic (keyless). Any device subscribed to that topic receives it. The topic name is the only secret — use an unguessable one. Defaults: priority 1 and auto-delete after 24h.',
    parameters: {
      message: { type: 'string', required: true, description: 'The notification body.' },
      title: { type: 'string', description: 'Notification title.' },
      topic: { type: 'string', description: 'Topic to publish to; defaults to the settings defaultNotifyTopic.' },
      priority: { type: 'integer', description: '1 (low/default) to 5 (urgent). Default 1.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: { type: 'string', required: true },
          sent: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'notified ' + value.topic }],
    },
    async execute(args) {
      const settings = ctx.settings.get(ns) as { defaultNotifyTopic?: string } | undefined
      const topic = args.topic ?? config.topic ?? settings?.defaultNotifyTopic ?? ''
      if (topic === '') throw new Error('notify topic is not set (arg, plugin config, or settings defaultNotifyTopic)')
      const priority = Math.min(Math.max(args.priority ?? 1, 1), 5)
      const headers: Record<string, string> = { 'Priority': String(priority), 'X-TTL': '24h' }
      if (args.title !== undefined) headers['Title'] = args.title
      await guardedFetch(baseUrl + '/' + encodeURIComponent(topic), {
        init: { method: 'POST', body: args.message, headers },
      })
      return { topic, sent: true }
    },
  }))
}

