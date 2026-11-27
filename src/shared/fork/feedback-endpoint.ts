// Feedback endpoint (BAD-895, FORK.md "Feedback and crash reports stay local"): where Send Feedback
// and crash reports are posted. Unset is off: nothing leaves the machine. Self-contained so the
// mobile app can import it.

export type ForkFeedbackEndpointSettings = {
  /** Fork (BAD-895): the http(s) address Send Feedback and crash reports are posted to; unset is none, which turns both off and keeps crash reports on this machine. */
  forkFeedbackEndpointUrl?: string
}

export const FORK_FEEDBACK_OFF_ERROR =
  'Feedback is off: no feedback address is set (forkFeedbackEndpointUrl).'

const MAX_URL_CHARS = 2048

/** The address to post to, or null when feedback is off; a value that is not a plain http(s) address reads as off. */
export function forkFeedbackEndpoint(settings: unknown): string | null {
  const raw: unknown =
    typeof settings === 'object' && settings !== null
      ? Reflect.get(settings, 'forkFeedbackEndpointUrl')
      : undefined
  return forkFeedbackUrlOrNull(raw)
}

export function forkFeedbackUrlOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > MAX_URL_CHARS || /\s/.test(text)) {
    return null
  }
  try {
    const url = new URL(text)
    const httpLike = url.protocol === 'http:' || url.protocol === 'https:'
    return httpLike && url.hostname && !url.username && !url.password ? text : null
  } catch {
    return null
  }
}
