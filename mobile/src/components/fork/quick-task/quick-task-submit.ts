// Quick task (SLRM-2428, FORK.md): the phone hands a typed or dictated task to its paired desktop,
// whose router picks the bot. The text rules and the reply check live here, apart from the sheet,
// so they are tested without React.
import {
  QUICK_TASK_SUBMIT_METHOD,
  QUICK_TASK_TEXT_MAX,
  type QuickTaskSubmitParams,
  type QuickTaskSubmitResult
} from '../../../../../src/shared/fork/quick-task-contract'
import { translate } from '../../../i18n/mobile-i18n'
import { isMobileMethodUnavailableError } from '../../../transport/rpc/mobile-method-unavailable'
import type { UnvalidatedRpcRequestPort } from '../../../transport/rpc/unvalidated-rpc-request-port'

// The router may read every bot's purpose before it answers, so allow more than a plain read.
export const QUICK_TASK_SUBMIT_TIMEOUT_MS = 90_000

export type QuickTaskTextCheck = { ok: true; text: string } | { ok: false; reason: string }

/** Trims the box and refuses an empty or oversized task, with the reason to show. */
export function checkQuickTaskText(raw: string): QuickTaskTextCheck {
  const text = raw.trim()
  if (text.length === 0) {
    return { ok: false, reason: translate('fork.quickTask.empty', 'Type or say a task first.') }
  }
  if (text.length > QUICK_TASK_TEXT_MAX) {
    return {
      ok: false,
      reason: translate(
        'fork.quickTask.tooLong',
        'A quick task can be at most {{max}} characters.',
        { max: QUICK_TASK_TEXT_MAX }
      )
    }
  }
  return { ok: true, text }
}

/** Adds dictated words after what is already typed, never past the length cap. */
export function appendQuickTaskDictation(current: string, transcript: string): string {
  const words = transcript.trim()
  if (!words) {
    return current
  }
  const joined = current.trim() ? `${current.replace(/\s+$/, '')} ${words}` : words
  return joined.slice(0, QUICK_TASK_TEXT_MAX)
}

/** Thrown when the paired desktop's Blackfish predates quick tasks. */
export class QuickTaskHostTooOldError extends Error {
  constructor() {
    super(
      translate(
        'fork.quickTask.hostTooOld',
        'This computer cannot take quick tasks yet. Update Blackfish on this computer.'
      )
    )
    this.name = 'QuickTaskHostTooOldError'
  }
}

function readResult(result: unknown): QuickTaskSubmitResult | null {
  if (!result || typeof result !== 'object') {
    return null
  }
  const record = result as Record<string, unknown>
  const { botName, chatId, note } = record
  if (typeof botName !== 'string' || !botName.trim() || typeof note !== 'string') {
    return null
  }
  if (chatId !== null && chatId !== undefined && typeof chatId !== 'string') {
    return null
  }
  return { botName, chatId: chatId ?? null, note }
}

/**
 * Sends the task to the host. The method is the desktop's own (the shared contract names it), so
 * the phone checks the reply itself rather than through the generated params catalog.
 */
export async function submitQuickTask(
  client: UnvalidatedRpcRequestPort,
  raw: string
): Promise<QuickTaskSubmitResult> {
  const checked = checkQuickTaskText(raw)
  if (!checked.ok) {
    throw new Error(checked.reason)
  }
  const params: QuickTaskSubmitParams = { text: checked.text, source: 'mobile' }
  const response = await client.sendRequest(QUICK_TASK_SUBMIT_METHOD, params, {
    timeoutMs: QUICK_TASK_SUBMIT_TIMEOUT_MS
  })
  if (!response.ok) {
    if (isMobileMethodUnavailableError(response.error.code, response.error.message)) {
      throw new QuickTaskHostTooOldError()
    }
    throw new Error(
      response.error.message ||
        translate('fork.quickTask.failed', 'The computer could not take this task.')
    )
  }
  const result = readResult(response.result)
  if (!result) {
    throw new Error(
      translate(
        'fork.quickTask.badReply',
        'The computer sent an answer this app does not understand. Update Blackfish on both.'
      )
    )
  }
  return result
}

/** The line shown once the host took the task. */
export function quickTaskSentMessage(result: QuickTaskSubmitResult): string {
  return translate('fork.quickTask.sent', 'Sent to {{botName}}', { botName: result.botName })
}
