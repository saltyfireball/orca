// Idle recovery (FORK.md): the whole feature in one process. The real service, candidate list,
// ending reader, classifier runner, sweep, state file and notifications run over a fake host
// (agent rows the test moves by hand), fake send ports and a clock the test sets. The classifier
// and notify commands are small node scripts in a temp dir. No agent, no model, no network.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { IDLE_RECOVERY_WAKE_MARKER, isWakePrompt } from '../../../shared/fork/idle-recovery'
import type { RuntimeWorktreeAgentRow } from '../../../shared/runtime-worktree-contracts'
import { listIdleRecoveryCandidatesWith } from './idle-recovery-candidates'
import { clearIdleRecoveryEndingCache, readIdleRecoveryEndingWith } from './idle-recovery-ending'
import { notifyIdleRecoveryWaiting } from './idle-recovery-notify'
import type { IdleRecoveryPorts } from './idle-recovery-ports'
import { createIdleRecoveryService, type IdleRecoveryStore } from './idle-recovery-service'
import {
  IDLE_RECOVERY_STATE_FILE_NAME,
  loadIdleRecoveryState,
  saveIdleRecoveryState
} from './idle-recovery-state'
import { runIdleRecoverySweep } from './idle-recovery-sweep'
import { NOW, agentRow, fakeHost, psWorktree } from './idle-recovery-test-fixtures'
import { sendIdleRecoveryAnswer, sendIdleRecoveryWake } from './idle-recovery-wake'

type Settings = Partial<ForkGlobalSettings>

const PANE = 'tab-1:leaf-1'
const MINUTE = 60_000
const QUESTION = 'The importer has an old column.\n\nShould I keep it or drop it?'

let stateDir = ''
let scriptDir = ''

beforeEach(() => {
  clearIdleRecoveryEndingCache()
  stateDir = mkdtempSync(path.join(tmpdir(), 'idle-recovery-e2e-state-'))
  scriptDir = mkdtempSync(path.join(tmpdir(), 'idle-recovery-e2e-scripts-'))
})

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(scriptDir, { recursive: true, force: true })
})

/** A classifier that calls every ending stalled, and adds a line to `log` each time it runs. */
function stalledClassifier(): { command: string; runs: () => number } {
  const file = path.join(scriptDir, 'stalled.js')
  const log = path.join(scriptDir, 'classifier-runs.log')
  writeFileSync(
    file,
    [
      "const { appendFileSync } = require('node:fs')",
      "let raw = ''",
      "process.stdin.on('data', (chunk) => (raw += chunk))",
      "process.stdin.on('end', () => {",
      '  const input = JSON.parse(raw)',
      '  appendFileSync(process.argv[2], `${input.version} ${input.wakes_this_turn}\\n`)',
      '  process.stdout.write(JSON.stringify({',
      "    verdict: 'stalled', reason: 'promised the tests and stopped', question: '',",
      "    next_step: 'Run the tests now.', wake_after_seconds: 0",
      '  }))',
      '})'
    ].join('\n')
  )
  return {
    command: `"${process.execPath}" "${file}" "${log}"`,
    runs: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0)
  }
}

/** A notify command that appends the JSON it is given on stdin to a file. */
function notifyCommand(): { command: string; payloads: () => { count: number }[] } {
  const file = path.join(scriptDir, 'notify.js')
  const out = path.join(scriptDir, 'notified.log')
  writeFileSync(
    file,
    [
      "const { appendFileSync } = require('node:fs')",
      "let raw = ''",
      "process.stdin.on('data', (chunk) => (raw += chunk))",
      "process.stdin.on('end', () => appendFileSync(process.argv[2], `${raw.trim()}\\n`))"
    ].join('\n')
  )
  return {
    command: `"${process.execPath}" "${file}" "${out}"`,
    payloads: () =>
      existsSync(out)
        ? readFileSync(out, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { count: number })
        : []
  }
}

/** One terminal agent the test moves by hand, the host that shows it and the ports that reach it. */
function world(initial: Settings) {
  let settings: Settings = initial
  const w = {
    now: NOW,
    row: agentRow({
      paneKey: PANE,
      prompt: 'fix the importer',
      lastAssistantMessage: QUESTION,
      stateStartedAt: NOW - 2 * MINUTE
    }) as RuntimeWorktreeAgentRow,
    /** Text the user has typed and not sent: a wake must leave the terminal alone. */
    draft: false,
    psReads: 0,
    statusReads: 0,
    sent: [] as string[],
    desktop: [] as string[],
    statePath: () => path.join(stateDir, IDLE_RECOVERY_STATE_FILE_NAME),
    set: (updates: Settings) => {
      settings = { ...settings, ...updates }
    },
    /** The agent ends its turn with `message` and then sits idle for `idleMs`. */
    endTurn: (message: string, idleMs = 2 * MINUTE) => {
      w.row = { ...w.row, state: 'done', lastAssistantMessage: message, stateStartedAt: w.now }
      w.now += idleMs
    },
    service: null as unknown as ReturnType<typeof createIdleRecoveryService>,
    /** A new service over the same state file, as after an app restart. */
    restart: () => {
      clearIdleRecoveryEndingCache()
      w.service = createIdleRecoveryService({
        now: () => w.now,
        loadState: () => loadIdleRecoveryState(w.statePath()),
        saveState: (state) => saveIdleRecoveryState(state, w.statePath()),
        sweep: (input) =>
          runIdleRecoverySweep({
            ...input,
            deps: {
              listCandidates: (s, nowMs) => listIdleRecoveryCandidatesWith(host, s, nowMs),
              readEnding: (candidate) => readIdleRecoveryEndingWith(host, candidate),
              sendWake: (candidate, nextStep) => sendIdleRecoveryWake(candidate, nextStep, ports)
            }
          }),
        notify: (items, s) =>
          notifyIdleRecoveryWaiting(items, s, {
            desktopNotifier: (title, body) => {
              w.desktop.push(`${title} | ${body}`)
            }
          }),
        sendAnswer: (chatId, text, target) => sendIdleRecoveryAnswer(chatId, text, target, ports),
        useRuntime: () => {},
        // No timer: the test runs each sweep itself.
        startTimer: () => () => {}
      })
      w.service.start(() => settings, { store: () => store })
    }
  }
  const store: IdleRecoveryStore = {
    getSettings: () => settings,
    updateSettings: (updates) => w.set(updates)
  }
  const host = fakeHost([], {
    worktreePs: async () => {
      w.psReads += 1
      return [psWorktree([w.row])]
    },
    terminalStatus: async () => {
      w.statusReads += 1
      return {
        prompt: w.row.prompt,
        lastAssistantMessage: w.row.lastAssistantMessage,
        transcriptPath: null
      }
    }
  })
  const ports: IdleRecoveryPorts = {
    chat: { read: () => null, send: async () => 'refused' },
    terminal: {
      bind: () => ({ handle: 'h1', binding: { ptyId: 'p1', processIncarnation: 'i1' } }),
      refusal: async () => (w.row.state !== 'done' ? 'in-turn' : w.draft ? 'draft' : null),
      send: async (_bound, _agent, text, stillClear) => {
        if (!(await stillClear())) {
          return 'refused'
        }
        // The agent takes the message as its next turn.
        w.sent.push(text)
        w.row = { ...w.row, state: 'working', prompt: text, stateStartedAt: w.now }
        return 'sent'
      }
    }
  }
  w.restart()
  return w
}

async function inbox(w: ReturnType<typeof world>) {
  return (await w.service.listInbox()).items
}

describe('idle recovery, end to end', () => {
  it('lists an idle chat that ended on a question, notifies once, and an answer clears it', async () => {
    const notify = notifyCommand()
    const w = world({
      forkIdleSweepMode: 'inbox',
      forkInboxNotifyDesktop: true,
      forkInboxNotifyCommand: notify.command
    })
    expect(await w.service.sweep()).toBe(true)
    expect(await inbox(w)).toMatchObject([
      {
        chatId: PANE,
        kind: 'terminal',
        agent: 'claude',
        worktreeId: 'wt-1',
        workspace: 'garden',
        verdict: 'waiting_user',
        question: 'Should I keep it or drop it?',
        wakes: 0,
        paused: false
      }
    ])
    expect(w.desktop).toHaveLength(1)
    expect(notify.payloads()).toMatchObject([{ count: 1 }])
    expect(existsSync(w.statePath())).toBe(true)

    // Still waiting a minute later: listed once, told once.
    w.now += MINUTE
    await w.service.sweep()
    await w.service.sweep()
    expect(await inbox(w)).toHaveLength(1)
    expect(w.desktop).toHaveLength(1)
    expect(notify.payloads()).toHaveLength(1)

    expect(await w.service.answer({ chatId: PANE, text: 'Keep it.' })).toEqual({
      chatId: PANE,
      result: 'sent'
    })
    // The user's own words, with no wake marker.
    expect(w.sent).toEqual(['Keep it.'])
    expect(await inbox(w)).toEqual([])

    w.endTurn('Kept the old column. All tests pass.')
    await w.service.sweep()
    expect(await inbox(w)).toEqual([])
    expect(w.sent).toHaveLength(1)
    expect(w.desktop).toHaveLength(1)
  })

  it('in mode wake, wakes a stalled chat up to the cap and then lists it, across restarts', async () => {
    const classifier = stalledClassifier()
    const w = world({
      forkIdleSweepMode: 'wake',
      forkIdleSweepClassifierCommand: classifier.command,
      forkIdleSweepMaxWakes: 2
    })
    w.row = { ...w.row, lastAssistantMessage: 'The fix is in. I will run the tests next.' }

    await w.service.sweep()
    expect(w.sent).toEqual([`${IDLE_RECOVERY_WAKE_MARKER}\nRun the tests now.`])
    expect(isWakePrompt(w.row.prompt)).toBe(true)
    expect(await inbox(w)).toEqual([])
    // The woken turn is in progress: nothing more is sent.
    w.now += 5 * MINUTE
    await w.service.sweep()
    expect(w.sent).toHaveLength(1)

    // The app restarts with one wake used.
    w.endTurn('Looked at the tests. I will run them in a moment.')
    w.restart()
    await w.service.sweep()
    expect(w.sent).toHaveLength(2)

    // The cap is reached: the third stall is listed, not woken, also after another restart.
    w.endTurn('Almost there. I will run them next.')
    w.restart()
    await w.service.sweep()
    w.now += 30 * MINUTE
    await w.service.sweep()
    w.restart()
    await w.service.sweep()
    expect(w.sent).toHaveLength(2)
    expect(await inbox(w)).toMatchObject([
      { chatId: PANE, verdict: 'stalled', wakes: 2, wakeAt: null, reason: /promised the tests/ }
    ])
    // One classifier run per ending, each told how many wakes the turn has had.
    expect(classifier.runs()).toBe(3)
    expect(readFileSync(path.join(scriptDir, 'classifier-runs.log'), 'utf8')).toBe(
      '1 0\n1 1\n1 2\n'
    )

    // A message from the user gives the chat its wakes back.
    expect(await w.service.answer({ chatId: PANE, text: 'Please run them.' })).toMatchObject({
      result: 'sent'
    })
    w.endTurn('Understood. I will run them next.')
    await w.service.sweep()
    expect(w.sent).toHaveLength(4)
    expect(isWakePrompt(w.sent[3])).toBe(true)
  })

  it('in mode inbox, lists a stalled chat and never wakes it', async () => {
    const classifier = stalledClassifier()
    const w = world({
      forkIdleSweepMode: 'inbox',
      forkIdleSweepClassifierCommand: classifier.command
    })
    for (let sweeps = 0; sweeps < 4; sweeps += 1) {
      await w.service.sweep()
      w.now += 10 * MINUTE
    }
    expect(w.sent).toEqual([])
    expect(await inbox(w)).toMatchObject([{ chatId: PANE, verdict: 'stalled', wakeAt: null }])
    expect(classifier.runs()).toBe(1)
    // A stalled chat is not a question for the user: no notification.
    expect(w.desktop).toEqual([])
  })

  it('while off, reads nothing, starts no process and writes no file', async () => {
    const classifier = stalledClassifier()
    const notify = notifyCommand()
    const w = world({
      forkIdleSweepClassifierCommand: classifier.command,
      forkInboxNotifyDesktop: true,
      forkInboxNotifyCommand: notify.command
    })
    expect(await w.service.sweep()).toBe(false)
    w.now += 10 * MINUTE
    expect(await w.service.sweep()).toBe(false)
    expect(await w.service.listInbox()).toMatchObject({ mode: 'off', items: [] })
    expect(await w.service.readStatus()).toMatchObject({ mode: 'off', running: false })
    expect(await w.service.answer({ chatId: PANE, text: 'x' })).toMatchObject({
      result: 'unavailable'
    })
    expect(w.psReads).toBe(0)
    expect(w.statusReads).toBe(0)
    expect(w.sent).toEqual([])
    expect(w.desktop).toEqual([])
    expect(classifier.runs()).toBe(0)
    expect(notify.payloads()).toEqual([])
    expect(readdirSync(stateDir)).toEqual([])
  })

  it('never wakes a chat while a background job of its turn is pending', async () => {
    const classifier = stalledClassifier()
    const w = world({
      forkIdleSweepMode: 'wake',
      forkIdleSweepClassifierCommand: classifier.command
    })
    // The agent's own turn is over; the row is held working by a background job.
    const ended = w.now - 2 * MINUTE
    w.row = {
      ...w.row,
      state: 'working',
      workingMode: 'monitoring',
      stateStartedAt: w.now - 10 * MINUTE,
      mainAgent: { state: 'done', stateStartedAt: ended }
    }
    for (let sweeps = 0; sweeps < 3; sweeps += 1) {
      await w.service.sweep()
      w.now += 10 * MINUTE
    }
    expect(w.sent).toEqual([])
    expect(await inbox(w)).toMatchObject([{ chatId: PANE, verdict: 'stalled', wakes: 0 }])

    // The job ends and the chat is still stalled on the same ending: now it is woken.
    w.row = { ...w.row, state: 'done', workingMode: undefined, stateStartedAt: ended }
    await w.service.sweep()
    expect(w.sent).toHaveLength(1)
    expect(classifier.runs()).toBe(1)
  })

  it('leaves a terminal with typed text alone, and a paused chat too', async () => {
    const classifier = stalledClassifier()
    const w = world({
      forkIdleSweepMode: 'wake',
      forkIdleSweepClassifierCommand: classifier.command
    })
    w.draft = true
    await w.service.sweep()
    w.now += 5 * MINUTE
    await w.service.sweep()
    expect(w.sent).toEqual([])
    expect(await inbox(w)).toMatchObject([{ verdict: 'stalled', wakes: 0 }])

    // Paused while listed: the row stays as it was, marked, and is not woken once the draft goes.
    await w.service.setPaused({ chatId: PANE, paused: true })
    w.draft = false
    w.now += 5 * MINUTE
    await w.service.sweep()
    expect(w.sent).toEqual([])
    expect(await inbox(w)).toMatchObject([{ verdict: 'stalled', paused: true }])
    expect(await w.service.readStatus()).toMatchObject({ stalled: 0, paused: [PANE] })

    await w.service.setPaused({ chatId: PANE, paused: false })
    await w.service.sweep()
    expect(w.sent).toHaveLength(1)
  })
})
