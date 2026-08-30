/**
 * guard-tools — DSH-native policy primitive over the tools pre-execute seam.
 * Demonstrates the §4.4 allow/deny/ask gate the righthand plugin uses to
 * gate high-impact deploy/invoke tools. Built on ctx.on('tools/pre-execute'),
 * not a hand-rolled wrapper.
 *
 * Rules are prefix-based. A rule may also declare `destructive: true` — a
 * pure documentation flag saying the gated tools have irreversible effects
 * (deploy, delete, DNS change): the kind of surface a tool *description*
 * (attacker-controlled text) could talk the agent into. The flag does not
 * change enforcement — `mode` does — it records WHY the prefix is guarded,
 * and `tests/permissions.golden` records it so guard changes are never
 * silent.
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
  /**
   * Documentation flag: the gated tools have irreversible effects nobody
   * asked for (a deploy, a delete, a DNS change). Declarative only —
   * enforcement is the rule's `mode`. Default false.
   */
  destructive?: boolean
  /** Only consulted when mode is 'ask'. Return true to allow. */
  ask?: (args: unknown) => boolean
}

/**
 * The guard facts a tool name resolves to: the mode the first matching rule
 * enforces (or 'none' when no rule matches) and whether that rule marks the
 * prefix destructive. This is the SINGLE lookup both the enforcement hook
 * and the permissions golden use, so the recorded facts cannot drift from
 * what the gate actually does.
 */
export interface GuardFacts {
  mode: 'allow' | 'deny' | 'ask' | 'none'
  destructive: boolean
  /** The matched rule, when one matched — the enforcement hook's ask path needs it. */
  rule: GuardRule | undefined
}

/** Resolve one tool name to its guard facts. Rules match in order, first wins. */
export function guardFactsFor(toolName: string, rules: readonly GuardRule[]): GuardFacts {
  const rule = rules.find(r => toolName.startsWith(r.toolPrefix))
  if (rule === undefined) return { mode: 'none', destructive: false, rule: undefined }
  return { mode: rule.mode, destructive: rule.destructive === true, rule }
}

/** Apply a guard over a set of tool-name prefixes. */
export function apply(ctx: Context, config: { rules?: GuardRule[] } = {}): void {
  const rules = config.rules ?? []

  ctx.on('tools/pre-execute', (exec, next) => {
    const facts = guardFactsFor(exec.name, rules)
    if (facts.mode === 'none' || facts.mode === 'allow') return next()
    if (facts.mode === 'deny') {
      throw new Error(`tool ${exec.name} is denied by righthand guard`)
    }
    const allowed = facts.rule?.ask?.(exec.arguments) ?? false
    if (!allowed) throw new Error(`tool ${exec.name} requires approval (ask returned false)`)
    return next()
  }, { prepend: true })
}
