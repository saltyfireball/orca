// Prompt stash (FORK.md, SLRM-2397): set a chat draft aside with its attachments and bring it
// back later. The stash is a short list, newest first, shared by every chat in this window's
// storage. Cmd+S (Ctrl+S) with a draft puts it on top; with an empty box it takes the top one back.

/** A draft as the message box keeps it; images are the attached files by their kept paths. */
export type ForkStashedDraft = {
  text: string
  /** The editor's document for exactly `text` (pills and pasted text tokens). */
  document?: unknown
  pastedTextFiles?: Record<string, string>
  images: { id: string; path: string; connectionId?: string }[]
  at: number
}

export const MAX_STASHED_DRAFTS = 20
/** A draft bigger than this is too big for the window's storage and stays in the box. */
export const MAX_STASHED_DRAFT_BYTES = 512 * 1024

export function isStashableDraft(draft: Pick<ForkStashedDraft, 'text' | 'images'>): boolean {
  return draft.text.trim() !== '' || draft.images.some((image) => image.path !== '')
}

/** The stash after setting a draft aside: on top, the oldest dropped past the limit. */
export function pushStash(
  stash: readonly ForkStashedDraft[],
  draft: ForkStashedDraft
): ForkStashedDraft[] {
  return [draft, ...stash].slice(0, MAX_STASHED_DRAFTS)
}

/** The draft at `index` and the stash without it; null when there is none there. */
export function takeStash(
  stash: readonly ForkStashedDraft[],
  index = 0
): { draft: ForkStashedDraft; rest: ForkStashedDraft[] } | null {
  const draft = stash[index]
  if (!draft) {
    return null
  }
  return { draft, rest: stash.filter((_, i) => i !== index) }
}

function readImage(value: unknown): ForkStashedDraft['images'][number] | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const { id, path, connectionId } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof path !== 'string' || path === '') {
    return null
  }
  return { id, path, ...(typeof connectionId === 'string' ? { connectionId } : {}) }
}

function readPasted(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string') {
      out[key] = text
    }
  }
  return out
}

/** The stash as stored text, cleaned; anything unreadable is dropped. */
export function parseStash(raw: string | null): ForkStashedDraft[] {
  if (!raw) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const out: ForkStashedDraft[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    if (typeof record.text !== 'string') {
      continue
    }
    const images = Array.isArray(record.images)
      ? record.images.map(readImage).filter((i): i is NonNullable<typeof i> => i !== null)
      : []
    const pasted = readPasted(record.pastedTextFiles)
    const draft: ForkStashedDraft = {
      text: record.text,
      images,
      at: typeof record.at === 'number' ? record.at : 0,
      ...(record.document && typeof record.document === 'object'
        ? { document: record.document }
        : {}),
      ...(pasted ? { pastedTextFiles: pasted } : {})
    }
    if (isStashableDraft(draft)) {
      out.push(draft)
    }
  }
  return out.slice(0, MAX_STASHED_DRAFTS)
}

/** One line naming a stashed draft in a menu. */
export function stashLabel(draft: Pick<ForkStashedDraft, 'text' | 'images'>, max = 60): string {
  const line = draft.text.trim().split('\n')[0] ?? ''
  const shown = line.length > max ? `${line.slice(0, max - 3)}...` : line
  const files = draft.images.length
  return files > 0 ? `${shown}${shown ? ' ' : ''}(+${files})` : shown
}
