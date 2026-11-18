// Prompt stash (FORK.md, SLRM-2397): Cmd+S (Ctrl+S elsewhere) in a chat's message box. With a
// draft, it sets the draft aside with its attachments and empties the box; with an empty box, it
// brings the newest stashed draft back. The stash is kept in this window's local storage, up to
// 20 drafts. Cmd+S is free there: the stock Save shortcut only acts in an editor, and its
// workspace fallback skips text inputs. `forkPromptStash` (unset is on) turns it off.
import type React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isMacPlatform } from '@/components/native-chat/pane/routing/native-chat-shortcut'
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from '@/components/native-chat/drafts/native-chat-composer-draft-store'
import type { NativeChatComposerDraftChange } from '@/components/native-chat/drafts/native-chat-composer-draft-storage'
import {
  MAX_STASHED_DRAFT_BYTES,
  isStashableDraft,
  parseStash,
  pushStash,
  takeStash,
  type ForkStashedDraft
} from '../../../../shared/fork/prompt-stash'

const STORAGE_KEY = 'blackfish.forkPromptStash.v1'
/** Files held only in this browser's memory (a web client's drop) cannot outlive the draft. */
const BROWSER_FILE_PREFIX = 'orca-browser-file:'

const listeners = new Set<() => void>()
let cache: ForkStashedDraft[] | null = null

export function readForkPromptStash(): ForkStashedDraft[] {
  if (cache === null) {
    try {
      cache = parseStash(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      cache = []
    }
  }
  return cache
}

function writeStash(next: ForkStashedDraft[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    return false
  }
  cache = next
  for (const listener of listeners) {
    listener()
  }
  return true
}

export function subscribeForkPromptStash(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isForkPromptStashOn(): boolean {
  return useAppStore.getState().settings?.forkPromptStash !== false
}

const EMPTY: NativeChatComposerDraftChange = {
  text: '',
  document: undefined,
  images: [],
  pastedTextFiles: {}
}

/** Set the box's draft aside; false (and a toast) when it cannot be kept, the draft stays. */
export function stashForkDraft(scopeKey: string): boolean {
  const draft = readNativeChatComposerDraft(scopeKey)
  const entry: ForkStashedDraft = {
    text: draft.text,
    images: draft.images
      .filter((image) => image.path !== '')
      .map(({ id, path, connectionId }) => ({
        id,
        path,
        ...(connectionId ? { connectionId } : {})
      })),
    at: Date.now(),
    ...(draft.document ? { document: draft.document } : {}),
    ...(draft.pastedTextFiles ? { pastedTextFiles: { ...draft.pastedTextFiles } } : {})
  }
  if (!isStashableDraft(entry)) {
    return false
  }
  const paths = [...entry.images.map((i) => i.path), ...Object.values(entry.pastedTextFiles ?? {})]
  const refuse = (message: string): false => {
    toast.error(message)
    return false
  }
  if (paths.some((path) => path.startsWith(BROWSER_FILE_PREFIX))) {
    return refuse(
      translate('fork.promptStash.browserFiles', 'Files dropped in this browser cannot be stashed.')
    )
  }
  if (JSON.stringify(entry).length > MAX_STASHED_DRAFT_BYTES) {
    return refuse(translate('fork.promptStash.tooBig', 'This draft is too big to stash.'))
  }
  if (!writeStash(pushStash(readForkPromptStash(), entry))) {
    return refuse(
      translate('fork.promptStash.full', 'The stash could not be saved; the draft stays.')
    )
  }
  updateNativeChatComposerDraft(scopeKey, EMPTY, 'immediate')
  toast.message(
    translate('fork.promptStash.stashed', 'Draft stashed. Cmd+S in an empty box brings it back.')
  )
  return true
}

/** Put a stashed draft in the box (only when it is empty) and take it out of the stash. */
export function restoreForkDraft(scopeKey: string, index = 0): boolean {
  const current = readNativeChatComposerDraft(scopeKey)
  if (current.text.trim() !== '' || current.images.length > 0) {
    toast.message(translate('fork.promptStash.notEmpty', 'Send or stash what is in the box first.'))
    return false
  }
  const taken = takeStash(readForkPromptStash(), index)
  if (!taken || !writeStash(taken.rest)) {
    return false
  }
  const { draft } = taken
  updateNativeChatComposerDraft(
    scopeKey,
    {
      text: draft.text,
      document: draft.document as NativeChatComposerDraftChange['document'],
      images: draft.images,
      pastedTextFiles: draft.pastedTextFiles ?? {}
    },
    'immediate'
  )
  return true
}

export function dropForkStashedDraft(index: number): void {
  const taken = takeStash(readForkPromptStash(), index)
  if (taken) {
    writeStash(taken.rest)
  }
}

function isStashChord(event: React.KeyboardEvent): boolean {
  const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's'
}

/** The composer's key handler with the stash chord in front of it. */
export function forkWithPromptStashKey(
  handler: React.KeyboardEventHandler<HTMLElement>,
  scopeKey: string,
  /** False for an edit of a queued message, whose draft is not the box's own. */
  enabled = true
): React.KeyboardEventHandler<HTMLElement> {
  if (!enabled) {
    return handler
  }
  return (event) => {
    if (!isStashChord(event) || event.nativeEvent.isComposing || !isForkPromptStashOn()) {
      handler(event)
      return
    }
    event.preventDefault()
    if (event.repeat) {
      return
    }
    const draft = readNativeChatComposerDraft(scopeKey)
    if (draft.text.trim() !== '' || draft.images.length > 0) {
      stashForkDraft(scopeKey)
    } else if (readForkPromptStash().length > 0) {
      restoreForkDraft(scopeKey)
    }
  }
}
