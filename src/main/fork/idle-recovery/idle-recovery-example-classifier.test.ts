// Idle recovery (FORK.md): the example classifier shipped in docs/fork/idle-recovery, run as a
// real command through the classifier runner. No model, no network.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IdleRecoveryClassifierInput } from '../../../shared/fork/idle-recovery'
import { readIdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import { classifyIdleRecoveryEnding } from './idle-recovery-classifier'

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../../../docs/fork/idle-recovery/example-classifier.mjs'
)
const settings = readIdleRecoverySettings({
  forkIdleSweepMode: 'wake',
  forkIdleSweepClassifierCommand: `"${process.execPath}" "${SCRIPT}"`,
  forkIdleSweepClassifierTimeoutSeconds: 20
})

function input(
  message: string,
  extra: Partial<IdleRecoveryClassifierInput> = {}
): IdleRecoveryClassifierInput {
  return {
    version: 1,
    chat: { id: 'chat-1', kind: 'chat', agent: 'claude', cwd: '/work', title: 'A chat' },
    request_source: 'user',
    role: 'standalone',
    last_user_request: 'Fix the bug.',
    last_assistant_message: message,
    idle_seconds: 60,
    background_pending: false,
    scheduled_wake: false,
    wakes_this_turn: 0,
    max_wakes: 2,
    ...extra
  }
}

async function verdictOf(
  message: string,
  extra: Partial<IdleRecoveryClassifierInput> = {}
): Promise<string> {
  return (await classifyIdleRecoveryEnding(input(message, extra), settings)).verdict
}

describe('the example idle recovery classifier', () => {
  it('calls a promised next step stalled and says what to carry on with', async () => {
    const verdict = await classifyIdleRecoveryEnding(
      input('The fix is in.\n\nNext, I will run the tests and report back.'),
      settings
    )
    expect(verdict).toMatchObject({ verdict: 'stalled', question: '', wakeAfterSeconds: 0 })
    expect(verdict.nextStep).toContain('I will run the tests and report back.')
  })

  it.each([
    'I found two ways to do it. Which one do you want?',
    'I can run the migration now.\n\nShall I go on?',
    'The branch is ready. Let me know and I will open the pull request.',
    '- Option A keeps the old name\n- Option B renames it\n\nPlease confirm which to use.',
    'I will run the tests next. Want me to push after that?'
  ])('lists a closing question as waiting on the user: %s', async (message) => {
    const verdict = await classifyIdleRecoveryEnding(input(message), settings)
    expect(verdict.verdict).toBe('waiting_user')
    expect(verdict.question).not.toBe('')
    expect(verdict.nextStep).toBe('')
  })

  it.each([
    'All done. The tests pass and the branch is pushed.',
    '',
    // A promise that waits on the user or on something outside the agent.
    'Once you approve the plan, I will start the migration.',
    'I will deploy it. I am waiting for the build to go green first.',
    "I'll finish this after you log in to the registry.",
    // A promise early in the message, with a finished ending.
    'I will run the tests next.\n\nThe tests ran: 40 passed. Nothing is left to do.',
    // Only inside code.
    'Here is the script:\n\n```sh\necho "I will run the tests next."\n```'
  ])('calls everything else finished: %s', async (message) => {
    expect(await verdictOf(message)).toBe('finished')
  })

  it('never calls a turn stalled that the user did not ask for, or one with work pending', async () => {
    const message = 'I will run the tests next.'
    expect(await verdictOf(message)).toBe('stalled')
    expect(await verdictOf(message, { request_source: 'orchestration' })).toBe('finished')
    expect(await verdictOf(message, { request_source: 'automation' })).toBe('finished')
    const pending = await classifyIdleRecoveryEnding(
      input(message, { background_pending: true }),
      settings
    )
    // Finished for now, with a later look asked for.
    expect(pending).toMatchObject({ verdict: 'finished', wakeAfterSeconds: 120 })
  })
})
