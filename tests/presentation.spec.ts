import { describe, it, expect } from 'vitest'
import { genCall, genResult, textOf } from '../src/cards.ts'

describe('card helpers', () => {
  it('genCall emits a titled generic card with a kind', () => {
    expect(genCall('Store grocery:milk', 'edit')).toEqual({ card: 'generic', title: 'Store grocery:milk', kind: 'edit' })
  })

  it('genResult carries the rendered content blocks', () => {
    const blocks = [{ type: 'text' as const, text: 'stored x (writes=1)' }]
    expect(genResult({ content: blocks })).toEqual({ card: 'generic', content: blocks })
  })

  it('textOf joins text blocks for terminal output', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })
})