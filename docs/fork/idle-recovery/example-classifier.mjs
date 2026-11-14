#!/usr/bin/env node
// An example classifier for idle recovery (docs/fork/idle-recovery.md). Rule based, no model, no
// network, no dependencies: it runs with nothing but Node.
//
// Use it by setting, in Settings > Advanced > Idle recovery:
//   Classifier command:  node "/path/to/example-classifier.mjs"
//
// It reads one JSON object on stdin and prints one JSON verdict on stdout. It is conservative:
// - a message that closes on a question, or asks you to choose or confirm, is `waiting_user`
// - `stalled` only when the closing lines promise work in the first person ("I will run the
//   tests next") and name nothing the agent is waiting for
// - everything else, and anything it cannot read, is `finished`, so nothing is woken
// Copy it and change the word lists below to fit how your agents write.

import { pathToFileURL } from 'node:url'

const QUESTION_PHRASES = [
  /\blet me know\b/i,
  /\b(?:do|did) you want\b/i,
  /\bwould you (?:like|prefer)\b/i,
  /\b(?:should|shall|can|may) i\b/i,
  /\bwant me to\b/i,
  /\bwhich (?:one|option|of)\b/i,
  /\bplease (?:confirm|choose|decide|advise)\b/i,
  /\bsay (?:go|yes|the word)\b/i,
  /\byour call\b/i
]

// A sentence that starts like this promises work the agent could have gone on to do.
const PROMISE =
  /^(?:(?:next|now|then|after that|first)[, ]+)?(?:i will|i'll|i am going to|i'm going to|let me|i am about to|i'm about to)\b/i

// Words that say the agent waits for something outside itself: never a reason to wake.
const BLOCKERS = [
  /\b(?:once|after|when|if|until|unless) you\b/i,
  /\bwait(?:ing)? (?:for|on|until)\b/i,
  /\bneeds? (?:your|you to|a|an|the)\b/i,
  /\b(?:approval|approve|permission|credentials?|password|log ?in|sign ?in|token|api key)\b/i,
  /\b(?:cannot|can't|unable to|blocked|not able to)\b/i,
  /\b(?:tomorrow|later today|next week)\b/i
]

function verdict(kind, reason, extra = {}) {
  return {
    verdict: kind,
    reason,
    question: '',
    next_step: '',
    wake_after_seconds: 0,
    ...extra
  }
}

/** The message without fenced code, so a `?` or "I will" inside code decides nothing. */
function withoutCode(message) {
  return message.replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/`[^`\n]*`/g, ' ')
}

/** The closing paragraph: the last run of non-empty lines, at most the last six. */
function closingLines(message) {
  const lines = withoutCode(message)
    .split('\n')
    .map((line) => line.trim())
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop()
  }
  const closing = []
  for (let index = lines.length - 1; index >= 0 && closing.length < 6; index -= 1) {
    if (lines[index] === '') {
      break
    }
    closing.unshift(lines[index])
  }
  return closing
}

/** A line without list marks, quote marks and trailing emphasis or brackets. */
function bare(line) {
  return line
    .replace(/^(?:[-*+>#]+|\d+[.)])\s+/, '')
    .replace(/[\s*_"')\]]+$/, '')
    .trim()
}

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

export function classify(input) {
  if (typeof input !== 'object' || input === null || input.version !== 1) {
    return verdict('finished', 'example classifier: unknown input version')
  }
  const message =
    typeof input.last_assistant_message === 'string' ? input.last_assistant_message : ''
  const closing = closingLines(message).map(bare).filter(Boolean)
  if (closing.length === 0) {
    return verdict('finished', 'example classifier: the turn ended with no text')
  }
  const closingText = closing.join(' ')

  // 1. A question to the user wins over everything: it is never a reason to wake.
  const last = closing.at(-1)
  const questionLine = closing.findLast((line) => line.endsWith('?'))
  if (
    last.endsWith('?') ||
    questionLine ||
    QUESTION_PHRASES.some((phrase) => phrase.test(closingText))
  ) {
    return verdict('waiting_user', 'example classifier: the message closes by asking you', {
      question: (questionLine ?? closingText).slice(0, 2000)
    })
  }

  // 2. Stalled: a first-person promise in the last two sentences, with nothing it waits for.
  const lastSentences = sentences(closingText).slice(-2)
  const promise = lastSentences.find((sentence) => PROMISE.test(sentence))
  if (!promise) {
    return verdict('finished', 'example classifier: no question and no promised next step')
  }
  if (BLOCKERS.some((blocker) => blocker.test(closingText))) {
    return verdict('finished', 'example classifier: the next step waits on something else')
  }
  if (input.request_source !== 'user' && input.request_source !== 'wake') {
    return verdict('finished', 'example classifier: this turn was not asked for by the user')
  }
  if (input.background_pending === true || input.scheduled_wake === true) {
    // Its own job or wake-up will bring it back: look again in two minutes instead.
    return verdict('finished', 'example classifier: background work is still pending', {
      wake_after_seconds: 120
    })
  }
  return verdict('stalled', 'example classifier: it promised a next step and stopped', {
    next_step:
      `Your last message ended with: "${promise.slice(0, 400)}" and then the turn stopped. ` +
      'Carry on and do that now. If something stops you, say what it is and ask.'
  })
}

async function main() {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    text += chunk
  }
  let input = null
  try {
    input = JSON.parse(text)
  } catch {
    input = null
  }
  process.stdout.write(`${JSON.stringify(classify(input))}\n`)
}

// Run only as a command, so a test or another script may import `classify`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
