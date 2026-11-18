import { describe, expect, it } from 'vitest'
import {
  MAX_STASHED_DRAFTS,
  isStashableDraft,
  parseStash,
  pushStash,
  stashLabel,
  takeStash,
  type ForkStashedDraft
} from './prompt-stash'
import { normalizeSavedPrompt, readForkSavedPromptSettings } from './saved-prompts'

const draft = (text: string, at = 1): ForkStashedDraft => ({ text, images: [], at })

describe('prompt stash', () => {
  it('stashes text or attachments, not an empty box', () => {
    expect(isStashableDraft(draft('  '))).toBe(false)
    expect(isStashableDraft(draft('hi'))).toBe(true)
    expect(isStashableDraft({ text: '', images: [{ id: 'i', path: '/tmp/a.png' }] })).toBe(true)
  })

  it('keeps the newest on top, at most 20', () => {
    let stash: ForkStashedDraft[] = []
    for (let i = 0; i < MAX_STASHED_DRAFTS + 3; i += 1) {
      stash = pushStash(stash, draft(`d${i}`, i))
    }
    expect(stash).toHaveLength(MAX_STASHED_DRAFTS)
    expect(stash[0].text).toBe(`d${MAX_STASHED_DRAFTS + 2}`)
  })

  it('takes one out', () => {
    const stash = [draft('a'), draft('b')]
    const taken = takeStash(stash, 1)
    expect(taken?.draft.text).toBe('b')
    expect(taken?.rest.map((d) => d.text)).toEqual(['a'])
    expect(takeStash([], 0)).toBeNull()
  })

  it('parses stored text and drops what it cannot read', () => {
    const raw = JSON.stringify([
      {
        text: 'ok',
        images: [
          { id: 'i', path: '/a.png' },
          { id: 'j', path: '' }
        ],
        at: 5
      },
      { text: '' },
      'junk',
      { text: 'with doc', images: [], document: { type: 'doc' }, pastedTextFiles: { p: '/t.txt' } }
    ])
    const parsed = parseStash(raw)
    expect(parsed.map((d) => d.text)).toEqual(['ok', 'with doc'])
    expect(parsed[0].images).toEqual([{ id: 'i', path: '/a.png' }])
    expect(parsed[1].pastedTextFiles).toEqual({ p: '/t.txt' })
    expect(parseStash('not json')).toEqual([])
    expect(parseStash(null)).toEqual([])
  })

  it('labels a draft by its first line and its files', () => {
    expect(stashLabel({ text: 'first\nsecond', images: [] })).toBe('first')
    expect(stashLabel({ text: 'x', images: [{ id: 'i', path: '/a' }] })).toBe('x (+1)')
    expect(stashLabel({ text: 'a'.repeat(100), images: [] }, 10)).toBe('aaaaaaa...')
  })
})

describe('saved prompts', () => {
  it('reads defaults: on, none', () => {
    expect(readForkSavedPromptSettings({})).toEqual({ enabled: true, prompts: [] })
  })

  it('labels a prompt by its first line and drops empty ones', () => {
    expect(normalizeSavedPrompt({ text: 'Review this\nmore' })).toEqual({
      label: 'Review this',
      text: 'Review this\nmore'
    })
    expect(normalizeSavedPrompt({ label: ' Mine ', text: 'x' })).toEqual({
      label: 'Mine',
      text: 'x'
    })
    expect(normalizeSavedPrompt({ text: '  ' })).toBeNull()
    expect(normalizeSavedPrompt('junk')).toBeNull()
  })
})
