# blueprint/skill-authoring

> Hermes source: hermes-agent-skill-authoring. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Author a packaged dsh skill: frontmatter drives catalog search, the body is the reference, registration is ctx.skills, shipping is the plugin release.

## The recipe

1. write the frontmatter (name + description first - it drives search).
2. write the body as a reference, not a tutorial.
3. register via ctx.skills on mount.
4. gate, ship, install.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| author | agent | skills/<name>/SKILL.md |
| register | skills module | ctx.skills.register |
| gate | pre-commit-gate | before publish |
| ship | npm publish | then profile install |

## Limits

the skill is markdown + registration - no runtime logic of its own.