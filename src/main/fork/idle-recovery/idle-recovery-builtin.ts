// Idle recovery (FORK.md), item C: the classifier used when no command is set.
// Contract: pure and synchronous. Never returns 'stalled' (so it never wakes a chat), and
// returns 'waiting_user' only when the last assistant message closes on a question; everything
// else is 'finished'.
//
// The rules read punctuation and layout, not words, so they hold in any language:
//   1. Lines inside a fenced code block are dropped, and so are quoted lines (starting '>'):
//      a question mark there is code or someone else's text.
//   2. The message closes on a question when its last line ends with a question mark, after
//      closing brackets, quotes and markdown emphasis are stripped from the line's end.
//   3. It also closes on a question when the last lines are a short list (the choices) and
//      the line just before the list ends with a question mark.
// A question earlier in the message, a request with no question mark ("tell me which") and
// an offer or a promise all read as 'finished'. Telling those apart needs a model: that is
// what the classifier command is for.
import {
  IDLE_RECOVERY_MESSAGE_TAIL_CHARS,
  tailForIdleRecoveryClassifier,
  type IdleRecoveryClassifierInput,
  type IdleRecoveryVerdict
} from '../../../shared/fork/idle-recovery'

/** Most list lines that may follow the question and still count as its choices. */
const MAX_CHOICE_LINES = 12
const MAX_QUESTION_CHARS = 2000

// The ASCII, fullwidth and Arabic question marks.
const QUESTION_MARKS = '?\uFF1F\u061F'
const ENDS_WITH_QUESTION = new RegExp(`[${QUESTION_MARKS}]$`)
// What may sit after the question mark: closing brackets, quotes and markdown emphasis.
const TRAILING_DECORATION = /[\s)\]}>"'`*_~\u00BB\u2019\u201D\u300D\u300F\uFF09]+$/
const FENCE = /^\s*(```|~~~)/
const QUOTED = /^\s*>/
// A bullet, "1." / "1)" / "(1)", or a single letter the same way.
const LIST_ITEM = /^\s*(?:[-*+\u2022]|\(?(?:\d{1,3}|[A-Za-z])[.):])\s+\S/

function finished(reason: string): IdleRecoveryVerdict {
  return { verdict: 'finished', reason, question: '', nextStep: '', wakeAfterSeconds: 0 }
}

/** The message's non-empty lines of prose, in order, without code blocks and quotes. */
function proseLines(message: string): string[] {
  const lines = message.split(/\r?\n/)
  const fences = lines.filter((line) => FENCE.test(line)).length
  // A tail cut out of a longer message may begin inside a code block: then the first fence
  // seen closes one, and the count of fences is odd.
  let inCode = fences % 2 === 1 && message.length >= IDLE_RECOVERY_MESSAGE_TAIL_CHARS
  const kept: string[] = []
  for (const line of lines) {
    if (FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (!inCode && !QUOTED.test(line) && line.trim()) {
      kept.push(line.trim())
    }
  }
  return kept
}

function endsWithQuestion(line: string): boolean {
  return ENDS_WITH_QUESTION.test(line.replace(TRAILING_DECORATION, ''))
}

/** The closing question with its choices, or null when the message does not close on one. */
function closingQuestion(lines: readonly string[]): string | null {
  const last = lines.length - 1
  if (last < 0) {
    return null
  }
  if (endsWithQuestion(lines[last])) {
    return lines[last]
  }
  let first = last
  while (first >= 0 && last - first < MAX_CHOICE_LINES && LIST_ITEM.test(lines[first])) {
    first -= 1
  }
  // `first` is now the line before the list: there must be a list, and that line must ask.
  if (first === last || first < 0 || LIST_ITEM.test(lines[first])) {
    return null
  }
  return endsWithQuestion(lines[first]) ? lines.slice(first).join('\n') : null
}

export function classifyIdleRecoveryBuiltin(
  input: IdleRecoveryClassifierInput
): IdleRecoveryVerdict {
  const message =
    typeof input.last_assistant_message === 'string'
      ? tailForIdleRecoveryClassifier(input.last_assistant_message)
      : ''
  const question = closingQuestion(proseLines(message))
  if (question === null) {
    return finished('built-in check: the message does not close on a question')
  }
  return {
    verdict: 'waiting_user',
    reason: 'built-in check: the message closes on a question',
    question: question.slice(0, MAX_QUESTION_CHARS),
    nextStep: '',
    wakeAfterSeconds: 0
  }
}
