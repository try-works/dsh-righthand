/**
 * guard-tools — DSH-native policy primitive over the tools pre-execute seam.
 * Demonstrates the §4.4 allow/deny/ask gate the righthand plugin uses to
 * gate high-impact deploy/invoke tools. Built on ctx.on('tools/pre-execute'),
 * not a hand-rolled wrapper.
 * @module dsh-righthand/guard-tools
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'righthand-guard'
export const inject = ['tools']

export interface GuardRule {
  /** Tool name prefix to gate (e.g. 'rh_' gates every righthand tool). */
  toolPrefix: string
  /** 'allow' passes through; 'deny' blocks; 'ask' defers to a policy function. */
  mode: 'allow' | 'deny' | 'ask'
  /** Only consulted when mode is 'ask'. Return true to allow. */
  ask?: (args: unknown) => boolean
}

/** Apply a guard over a set of tool-name prefixes. */
export function apply(ctx: Context, config: { rules?: GuardRule[] } = {}): void {
  const rules = config.rules ?? []

  ctx.on('tools/pre-execute', (exec, next) => {
    const rule = rules.find(r => exec.name.startsWith(r.toolPrefix))
    if (rule === undefined) return next()
    if (rule.mode === 'deny') {
      throw new Error(`tool ${exec.name} is denied by righthand guard`)
    }
    if (rule.mode === 'ask') {
      const allowed = rule.ask?.(exec.arguments) ?? false
      if (!allowed) throw new Error(`tool ${exec.name} requires approval (ask returned false)`)
      return next()
    }
    return next()
  }, { prepend: true })
}