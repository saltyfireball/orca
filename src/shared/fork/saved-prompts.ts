// Saved prompts (FORK.md, SLRM-2397): a list of labelled prompts kept in settings, offered in a
// menu on the chat message box. Choosing one puts its text in the box at the caret; nothing is
// sent until the user sends it.

export type ForkSavedPrompt = { label: string; text: string }

export const MAX_SAVED_PROMPTS = 50
export const MAX_SAVED_PROMPT_LABEL = 60
export const MAX_SAVED_PROMPT_TEXT = 8000

export type ForkSavedPromptSettings = { enabled: boolean; prompts: ForkSavedPrompt[] }

type SavedPromptSource = {
  forkSavedPromptsEnabled?: boolean
  forkSavedPrompts?: ForkSavedPrompt[]
}

/** One prompt as stored: trimmed, bounded, with a label taken from its text when it has none. */
export function normalizeSavedPrompt(value: unknown): ForkSavedPrompt | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.slice(0, MAX_SAVED_PROMPT_TEXT) : ''
  if (text.trim() === '') {
    return null
  }
  const given = typeof record.label === 'string' ? record.label.trim() : ''
  const label = (given || text.trim().split('\n')[0]).slice(0, MAX_SAVED_PROMPT_LABEL).trim()
  return { label, text }
}

export function readForkSavedPromptSettings(
  settings: SavedPromptSource | null | undefined
): ForkSavedPromptSettings {
  const raw = Array.isArray(settings?.forkSavedPrompts) ? settings.forkSavedPrompts : []
  return {
    enabled: settings?.forkSavedPromptsEnabled !== false,
    prompts: raw
      .map(normalizeSavedPrompt)
      .filter((p): p is ForkSavedPrompt => p !== null)
      .slice(0, MAX_SAVED_PROMPTS)
  }
}
