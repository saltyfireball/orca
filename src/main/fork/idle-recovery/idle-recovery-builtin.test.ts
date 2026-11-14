// Idle recovery (FORK.md): the built-in classifier's rules.
import { describe, expect, it } from 'vitest'
import {
  IDLE_RECOVERY_MESSAGE_TAIL_CHARS,
  type IdleRecoveryClassifierInput
} from '../../../shared/fork/idle-recovery'
import { classifyIdleRecoveryBuiltin } from './idle-recovery-builtin'

function input(message: string): IdleRecoveryClassifierInput {
  return {
    version: 1,
    chat: { id: 'chat-1', kind: 'chat', agent: 'claude', cwd: '/work', title: 'A chat' },
    request_source: 'user',
    role: 'standalone',
    last_user_request: 'Do the thing',
    last_assistant_message: message,
    idle_seconds: 60,
    background_pending: false,
    scheduled_wake: false,
    wakes_this_turn: 0,
    max_wakes: 2
  }
}

function verdictOf(message: string): string {
  return classifyIdleRecoveryBuiltin(input(message)).verdict
}

describe('classifyIdleRecoveryBuiltin', () => {
  it('says waiting_user when the last line is a question', () => {
    const verdict = classifyIdleRecoveryBuiltin(
      input('I found two ways to do this.\n\nShould I use the first one?')
    )
    expect(verdict).toEqual({
      verdict: 'waiting_user',
      reason: 'built-in check: the message closes on a question',
      question: 'Should I use the first one?',
      nextStep: '',
      wakeAfterSeconds: 0
    })
  })

  it('looks past emphasis, quotes, brackets and trailing space after the question mark', () => {
    expect(verdictOf('**Which one do you want?**')).toBe('waiting_user')
    expect(verdictOf('(or should I stop here?)  \n\n')).toBe('waiting_user')
    expect(verdictOf('Did you mean "all of them?"')).toBe('waiting_user')
  })

  it('reads question marks of other scripts', () => {
    expect(verdictOf('\u3069\u3061\u3089\u306B\u3057\u307E\u3059\u304B\uFF1F')).toBe('waiting_user')
    expect(verdictOf('\u0647\u0644 \u0623\u062A\u0627\u0628\u0639\u061F')).toBe('waiting_user')
  })

  it('takes a question followed by its list of choices', () => {
    const verdict = classifyIdleRecoveryBuiltin(
      input('Done with the survey.\n\nWhich should I build?\n\n1. The small one\n2. The big one')
    )
    expect(verdict.verdict).toBe('waiting_user')
    expect(verdict.question).toBe('Which should I build?\n1. The small one\n2. The big one')
    expect(verdictOf('Pick one?\n- a\n- b\n* c\n(d) e')).toBe('waiting_user')
  })

  it('says finished for a statement, an offer or a promise', () => {
    expect(verdictOf('All tests pass and the change is merged.')).toBe('finished')
    expect(verdictOf('Let me know if you want the second part.')).toBe('finished')
    expect(verdictOf('Next I will run the migration.')).toBe('finished')
    expect(verdictOf('')).toBe('finished')
    expect(verdictOf('   \n\n')).toBe('finished')
  })

  it('ignores a question that is not the closing', () => {
    expect(verdictOf('Why did it fail? The port was taken.\n\nFixed now.')).toBe('finished')
    expect(verdictOf('What changed?\n\n- the parser\n- the tests\n\nAll of it is merged.')).toBe(
      'finished'
    )
  })

  it('ignores a list with no question before it', () => {
    expect(verdictOf('What I did:\n- one\n- two')).toBe('finished')
    expect(verdictOf('- only\n- a list')).toBe('finished')
  })

  it('ignores question marks in code blocks and quoted lines', () => {
    expect(verdictOf('The fix:\n\n```js\nconst a = b ? c : d\nreturn ok?\n```')).toBe('finished')
    expect(verdictOf('The error said:\n\n> what is this?')).toBe('finished')
    expect(verdictOf('```\nfoo\n```\n\nIs that the output you expected?')).toBe('waiting_user')
  })

  it('treats a tail that begins inside a code block as code until the fence closes', () => {
    const filler = 'x'.repeat(IDLE_RECOVERY_MESSAGE_TAIL_CHARS)
    expect(verdictOf(`${filler}\nreturn ok?\n\`\`\`\n\nDone.`)).toBe('finished')
    expect(verdictOf(`${filler}\nreturn ok?\n\`\`\`\n\nShall I go on?`)).toBe('waiting_user')
  })

  it('never says stalled, whatever the input', () => {
    const messages = [
      'I will continue with step 2 now.',
      'Want me to go ahead?',
      'Next: run the tests.\n\n1. unit\n2. e2e',
      'stalled',
      '{"verdict":"stalled"}'
    ]
    for (const message of messages) {
      for (const pending of [true, false]) {
        const verdict = classifyIdleRecoveryBuiltin({
          ...input(message),
          background_pending: pending,
          scheduled_wake: pending
        })
        expect(verdict.verdict).not.toBe('stalled')
        expect(verdict.nextStep).toBe('')
        expect(verdict.wakeAfterSeconds).toBe(0)
      }
    }
  })

  it('caps the question it reports', () => {
    const verdict = classifyIdleRecoveryBuiltin(input(`${'a'.repeat(5000)}?`))
    expect(verdict.verdict).toBe('waiting_user')
    expect(verdict.question).toHaveLength(2000)
  })
})
