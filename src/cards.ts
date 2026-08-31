/**
 * cards.ts - shared presentCall/presentResult helpers for the rh_* families.
 * The harness GUI renders ToolCallView/ToolResultView as conversation cards;
 * every tool family opts in through these two-liners.
 */

import type { ToolCallKind, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** A titled pending-state card with an icon category. */
export function genCall(title: string, kind: ToolCallKind): ToolCallView {
  return { card: 'generic', title, kind }
}

/** The completed card carrying the tool's rendered summary text. */
export function genResult(result: { content: ContentBlock[] }): ToolResultView {
  return { card: 'generic', content: result.content }
}

/** Extract the plain text from content blocks (for terminal output). */
export function textOf(content: ContentBlock[]): string {
  return content.map(b => b.type === 'text' ? b.text : '').join('\n')
}