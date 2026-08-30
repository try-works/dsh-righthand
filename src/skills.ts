/**
 * The bundled dsh-righthand skill registration.
 *
 * Lives at `skills/dsh-righthand/SKILL.md` and registers with a directory
 * `resourceBase` pointing at the bundled copy, so any relative references
 * inside the SKILL.md resolve against the package's own files (the
 * dsh-plugin packaged-skill standard, same shape as dsh-anti-slop).
 *
 * @module @try-works/dsh-righthand/src/skills
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
// Type-only import activates the cordis Context augmentation for `ctx.skills`.
import type {} from '@deepseek-ai/dsh-skill'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'righthand-skills'
export const inject = ['skills']

export const SKILL_NAME = 'dsh-righthand'

/** Routing description shown by skill discovery (matches the SKILL.md frontmatter). */
export const SKILL_DESCRIPTION = 'Use when a task needs the righthand toolkit — durable key-value storage (rh_store_*), credential and settings management (rh_credential_* / rh_settings_*), governed command execution (rh_run / rh_run_bg), or its tool guard policy. Covers tool reference, guard semantics, and service availability.'

/** The bundled skill directory (this module lives in the bundle at lib/skills.js). */
export function skillDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', `skills/${SKILL_NAME}`)
}

/** The skill body: SKILL.md verbatim from the bundled skill directory. */
export function skillBody(): string {
  return readFileSync(join(skillDirectory(), 'SKILL.md'), 'utf8')
}

/** Register the packaged skill. Returns the cordis effect disposer. */
export function apply(ctx: Context): void {
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'bundled',
    content: skillBody(),
    resourceBase: { kind: 'directory', path: skillDirectory() },
  })
}

