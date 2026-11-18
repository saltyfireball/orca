// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Draft = {
  text: string
  images: { id: string; path: string }[]
  document?: unknown
  pastedTextFiles?: Record<string, string>
}
const drafts = new Map<string, Draft>()
const empty: Draft = { text: '', images: [] }

vi.mock('sonner', () => ({ toast: { message: vi.fn(), error: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, text: string) => text }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: { forkPromptStash: settingOn ? undefined : false } })
  }
}))
vi.mock('@/components/native-chat/pane/routing/native-chat-shortcut', () => ({
  isMacPlatform: () => true
}))
vi.mock('@/components/native-chat/drafts/native-chat-composer-draft-store', () => ({
  readNativeChatComposerDraft: (scope: string) => drafts.get(scope) ?? empty,
  updateNativeChatComposerDraft: (scope: string, change: Partial<Draft>) => {
    drafts.set(scope, { ...(drafts.get(scope) ?? empty), ...change } as Draft)
  }
}))

let settingOn = true
const { forkWithPromptStashKey, readForkPromptStash } = await import('./fork-prompt-stash')

function press(handler: (event: never) => void, init: Partial<KeyboardEvent> = {}) {
  const event = {
    key: 's',
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    ...init
  }
  handler(event as never)
  return event
}

beforeEach(() => {
  window.localStorage.clear()
  drafts.clear()
  settingOn = true
})

describe('prompt stash key', () => {
  it('stashes a draft with its attachments, then brings it back into the empty box', () => {
    const inner = vi.fn()
    const handler = forkWithPromptStashKey(inner, 'scope-a')
    drafts.set('scope-a', { text: 'half a thought', images: [{ id: 'i', path: '/tmp/a.png' }] })
    const first = press(handler)
    expect(first.preventDefault).toHaveBeenCalled()
    expect(drafts.get('scope-a')?.text).toBe('')
    expect(readForkPromptStash()).toHaveLength(1)
    press(handler)
    expect(drafts.get('scope-a')).toMatchObject({
      text: 'half a thought',
      images: [{ id: 'i', path: '/tmp/a.png' }]
    })
    expect(readForkPromptStash()).toHaveLength(0)
    expect(inner).not.toHaveBeenCalled()
  })

  it('passes other keys and the chord with Shift through', () => {
    const inner = vi.fn()
    const handler = forkWithPromptStashKey(inner, 'scope-b')
    press(handler, { key: 'a' })
    press(handler, { shiftKey: true })
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('does nothing of its own when off, or for a queued message edit', () => {
    const inner = vi.fn()
    expect(forkWithPromptStashKey(inner, 'scope-c', false)).toBe(inner)
    settingOn = false
    drafts.set('scope-c', { text: 'x', images: [] })
    press(forkWithPromptStashKey(inner, 'scope-c'))
    expect(inner).toHaveBeenCalledTimes(1)
    expect(drafts.get('scope-c')?.text).toBe('x')
  })

  it('refuses files held only in browser memory and keeps the draft', () => {
    drafts.set('scope-d', {
      text: 'x',
      images: [{ id: 'i', path: 'orca-browser-file:abc/a.png' }]
    })
    press(forkWithPromptStashKey(vi.fn(), 'scope-d'))
    expect(drafts.get('scope-d')?.text).toBe('x')
    expect(readForkPromptStash()).toHaveLength(0)
  })
})
