/**
 * text-tools — rh_text_* over ctx.llm.
 * Language work at one call per verb: summarise, extract-to-JSON,
 * classify, translate. Same prompt discipline as the digest summarizer:
 * roles stay roles, caps are deliberate, each call's failure is contained
 * in that call (the other tools are unaffected).
 * @module dsh-righthand/text-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export const name = 'righthand-text'
export const inject = ['tools', 'llm']

export interface TextConfig {
  /** LLM route; defaults match the harness default model. */
  provider?: string
  model?: string
}

const DEFAULTS: Required<TextConfig> = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

/** One LLM call, text in, text out. Returns the assembled text or throws. */
async function ask(ctx: Context, cfg: Required<TextConfig>, system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<string> {
  const options: GenerateOptions = deepFreeze({
    provider: cfg.provider,
    model: cfg.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin: 'righthand-text' },
    })],
    system,
    maxTokens,
    purpose: 'compaction',
    signal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  if (assembler.finish.kind !== 'stop') throw new Error('text model call did not stop cleanly: ' + JSON.stringify(assembler.finish.kind))
  const text = assembler.blocks().filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').trim()
  if (text === '') throw new Error('text model call produced no text')
  return text
}

/** Extract the outermost {...} JSON object from a model reply. */
function parseJsonWindow(text: string): any {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('model output was not JSON')
  return JSON.parse(text.slice(start, end + 1))
}

/** Summarise: plain prose, no JSON. */
const SUMMARISE_SYSTEM = 'You summarise text. Return ONLY the summary itself - a few sentences, plain prose, no JSON, no Markdown headers, no quotes around it. Preserve the language of the input.'

/** Extract: JSON matching a caller schema. */
const EXTRACT_SYSTEM = 'You extract structured data from text. Return ONLY one JSON object matching the caller schema exactly - no prose, no Markdown, no code fences.'

/** Classify: one label plus confidence, as JSON. */
const CLASSIFY_SYSTEM = 'You classify text. Return ONLY one JSON object with exactly two keys: label (one of the given labels, verbatim) and confidence (a number from 0 to 1). No prose, no Markdown.'

/** Translate: preserve formatting, plain prose. */
const TRANSLATE_SYSTEM = 'You translate text. Return ONLY the translation - plain prose, no JSON, no quotes around it, preserving paragraph breaks and any Markdown or code the input contains.'

export function apply(ctx: Context, config: TextConfig = {}): void {
  const cfg: Required<TextConfig> = { ...DEFAULTS, ...config }
  ctx.tools.register(defineTool({
    name: 'rh_text_summarise',
    description: 'Summarise text into a few sentences. One model call per invocation; the result is new prose, not extracted sentences.',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to summarise (max ~30000 characters).' },
      sentences: { type: 'integer', description: 'Target length in sentences (default 3).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args, exec) {
      const n = args.sentences ?? 3
      const summary = await ask(ctx, cfg, SUMMARISE_SYSTEM, 'Summarise this in about ' + n + ' sentences:\n\n' + args.text, 600, exec.signal)
      return { summary }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'rh_text_extract',
    description: 'Turn text into JSON matching a schema you give. The schema is a JSON Schema object; the model returns one object conforming to it, or the call fails cleanly.',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to extract from.' },
      schema: { type: 'json', required: true, description: 'JSON Schema the result must match, e.g. { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          extracted: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.extracted) }],
    },
    async execute(args, exec) {
      const framed = 'Schema:\n' + JSON.stringify(args.schema) + '\n\nText:\n' + args.text
      const raw = await ask(ctx, cfg, EXTRACT_SYSTEM, framed, 800, exec.signal)
      return { extracted: parseJsonWindow(raw) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'rh_text_classify',
    description: 'Sort text into one of the labels you give, with a confidence score from 0 to 1. The label returned is one of yours, verbatim.',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to classify.' },
      labels: { type: 'array', required: true, items: { type: 'string' }, description: 'The candidate labels, e.g. ["bug", "feature request", "question"].' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true },
          confidence: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.label + ' (' + value.confidence + ')' }],
    },
    async execute(args, exec) {
      if (args.labels.length === 0) throw new Error('classify needs at least one label')
      const framed = 'Labels: ' + JSON.stringify(args.labels) + '\n\nText:\n' + args.text
      const raw = await ask(ctx, cfg, CLASSIFY_SYSTEM, framed, 100, exec.signal)
      const parsed = parseJsonWindow(raw)
      if (typeof parsed.label !== 'string' || !args.labels.includes(parsed.label)) throw new Error('model returned a label outside the given set')
      const confidence = Number(parsed.confidence)
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('model returned an invalid confidence')
      return { label: parsed.label, confidence }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'rh_text_translate',
    description: 'Translate text into another language, preserving formatting (paragraph breaks, Markdown, code).',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to translate.' },
      language: { type: 'string', required: true, description: 'The target language, e.g. "Spanish", "zh-CN", "Japanese".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          translation: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.translation }],
    },
    async execute(args, exec) {
      const framed = 'Translate the following into ' + args.language + ':\n\n' + args.text
      const translation = await ask(ctx, cfg, TRANSLATE_SYSTEM, framed, 800, exec.signal)
      return { translation }
    },
  }))
}





