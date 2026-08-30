/**
 * dsh-righthand — DeepSeek Harness plugin.
 * DSH-native righthand tools: a durable KV store, credential/settings
 * management, governed command execution, and a tool guard — all built on
 * the harness's own services (storageDomain, credentials, settings,
 * subprocess, jobs, tools), not hand-rolled primitives.
 *
 * The package's plugin entry (name/inject/apply) mounts the tool families
 * and the packaged skill as child fibers; each child waits on its own
 * services, so a
 * profile without `storageDomain` (e.g. headless) simply gets the other
 * seven tools instead of failing the boot.
 *
 * Modules (each individually mountable via `export * as ...`):
 * - store-tools:     rh_store_put/get/delete/list over ctx.storageDomain
 * - secrets-tools:   rh_credential_describe/set/unset + rh_settings_get/set
 * - task-tools:      rh_task_create/list/next/update/delete over ctx.storageDomain
 * - exec-tools:      rh_run / rh_run_bg over ctx.subprocess + ctx.jobs
 * - guard-tools:     tools/pre-execute policy (config.rules)
 * - skills:          the packaged dsh-righthand skill (ctx.skills)
 *
 * @module @try-works/dsh-righthand
 */

import type { Context } from '@deepseek-ai/cordis'
import * as storeTools from './store-tools.ts'
import * as secretsTools from './secrets-tools.ts'
import * as execTools from './exec-tools.ts'
import * as guardTools from './guard-tools.ts'
import * as taskTools from './task-tools.ts'
import * as righthandSkills from './skills.ts'
import type { GuardRule } from './guard-tools.ts'

export const name = 'dsh-righthand'

/** The combined plugin needs no services itself; each child waits on its own. */
export const inject: string[] = []

/** Combined-plugin configuration. */
export interface RighthandConfig {
  /** guard-tools policy rules; omitted rules leave the guard inert. */
  rules?: GuardRule[]
}

/**
 * Mount the four righthand tool modules as child fibers.
 * Each child declares its own service inject, so a profile missing one
 * service (e.g. `storageDomain` outside the web profile) skips that family
 * instead of failing the whole plugin.
 */
export function apply(ctx: Context, config: RighthandConfig = {}): void {
  ctx.plugin(storeTools)
  ctx.plugin(secretsTools)
  ctx.plugin(execTools)
  ctx.plugin(taskTools)
  ctx.plugin(guardTools, { rules: config.rules ?? [] })
  ctx.plugin(righthandSkills)
}

// Individual modules stay importable for selective mounting.
export { storeTools, secretsTools, execTools, taskTools, guardTools, righthandSkills }
export { SKILL_NAME, SKILL_DESCRIPTION, skillDirectory, skillBody } from './skills.ts'
export type { GuardRule } from './guard-tools.ts'
export { guardFactsFor } from './guard-tools.ts'
export type { GuardFacts } from './guard-tools.ts'

