import { describe, expect, it, vi } from 'vitest'
import { readLimitResumeSettings } from '../../../shared/fork/limit-resume'
import type { LimitResumeMemos } from './limit-resume-memos'
import {
  LimitResumeSweep,
  type LimitResumePorts,
  type LimitResumeTerminalRow
} from './limit-resume-sweep'

const settings = readLimitResumeSettings({})
const NOW = Date.UTC(2026, 10, 17, 15, 0)
const LIMIT = "You've hit your usage limit. Try again in 10 minutes."

type Pane = { row: LimitResumeTerminalRow; screen: string[] | null; refusal?: string | null }

function setup(panes: Pane[], memos: LimitResumeMemos = new Map()) {
  let now = NOW
  const sent: { paneKey: string; text: string }[] = []
  const dismissed: string[] = []
  const saveMemos = vi.fn(async () => {})
  const byKey = () => new Map(panes.map((pane) => [pane.row.paneKey, pane]))
  const ports: LimitResumePorts = {
    rows: async () => panes.map((pane) => pane.row),
    screen: async (paneKey) => byKey().get(paneKey)?.screen ?? null,
    refusal: async (paneKey) => byKey().get(paneKey)?.refusal ?? null,
    send: async (paneKey, _agent, text) => {
      sent.push({ paneKey, text })
      return 'sent'
    },
    dismissSwitchPrompt: async (paneKey) => {
      dismissed.push(paneKey)
      return 'sent'
    }
  }
  const sweep = new LimitResumeSweep({ ports, memos, saveMemos, now: () => now })
  return {
    sweep,
    sent,
    dismissed,
    memos,
    saveMemos,
    advance: (ms: number) => {
      now += ms
    }
  }
}

const row = (overrides: Partial<LimitResumeTerminalRow> = {}): LimitResumeTerminalRow => ({
  paneKey: 'tab-1:leaf-1',
  worktreeId: 'wt-1',
  agent: 'codex',
  title: 'fix the bug',
  working: false,
  updatedAt: NOW - 1000,
  ...overrides
})

describe('LimitResumeSweep', () => {
  it('parks a terminal agent on a limit and resumes it after the reset and the delay', async () => {
    const pane: Pane = { row: row(), screen: ['work', LIMIT, '', '> '] }
    const { sweep, sent, advance, memos } = setup([pane])
    expect(await sweep.pass(settings)).toBe(true)
    const [entry] = sweep.entries(settings)
    expect(entry).toMatchObject({ state: 'parked', resetsAt: NOW + 10 * 60_000, tries: 0 })
    expect(entry.resumeAt).toBe(NOW + 11 * 60_000)
    advance(5 * 60_000)
    await sweep.pass(settings)
    expect(sent).toEqual([])
    advance(6 * 60_000)
    await sweep.pass(settings)
    expect(sent).toEqual([{ paneKey: 'tab-1:leaf-1', text: 'continue' }])
    expect(memos.get('tab-1:leaf-1')).toMatchObject({ tries: 1, answeredLine: LIMIT })
    expect(sweep.entries(settings)).toEqual([])
    // The same stop still on screen is never answered twice.
    advance(60 * 60_000)
    await sweep.pass(settings)
    expect(sent).toHaveLength(1)
  })

  it('backs off when no reset is given, doubling per try', async () => {
    const pane: Pane = { row: row(), screen: ["You've hit your usage limit."] }
    const { sweep } = setup([pane], new Map([['tab-1:leaf-1', { tries: 2, at: NOW }]]))
    await sweep.pass(settings)
    expect(sweep.entries(settings)[0]).toMatchObject({
      resetsAt: null,
      resumeAt: NOW + 30 * 60_000 * 4
    })
  })

  it('holds while someone types there, then sends once clear', async () => {
    const pane: Pane = { row: row(), screen: [LIMIT], refusal: 'typed-since-idle' }
    const { sweep, sent, advance } = setup([pane])
    await sweep.pass(settings)
    advance(12 * 60_000)
    await sweep.pass(settings)
    expect(sent).toEqual([])
    expect(sweep.entries(settings)[0].state).toBe('held')
    pane.refusal = null
    await sweep.pass(settings)
    expect(sent).toHaveLength(1)
  })

  it('stops at the cap and waits for the user', async () => {
    const pane: Pane = { row: row(), screen: [LIMIT] }
    const { sweep, sent, advance } = setup(
      [pane],
      new Map([['tab-1:leaf-1', { tries: settings.maxTries, at: NOW }]])
    )
    await sweep.pass(settings)
    advance(60 * 60_000)
    await sweep.pass(settings)
    expect(sent).toEqual([])
    expect(sweep.entries(settings)[0].state).toBe('exhausted')
  })

  it('leaves a busy agent, Claude going on by itself, and anything cancelled', async () => {
    const busy: Pane = {
      row: row({ paneKey: 'a:1', working: true, updatedAt: NOW }),
      screen: [LIMIT]
    }
    const self: Pane = {
      row: row({ paneKey: 'b:1', agent: 'claude' }),
      screen: ['Usage limit reached \u00b7 continuing automatically at 3:45pm \u00b7 esc to cancel']
    }
    const cancelled: Pane = { row: row({ paneKey: 'c:1' }), screen: [LIMIT] }
    const { sweep, sent, advance } = setup([busy, self, cancelled])
    await sweep.pass(settings)
    expect(sweep.entries(settings).map((entry) => entry.id)).toEqual(['c:1'])
    expect(await sweep.cancel('c:1')).toBe(true)
    advance(60 * 60_000)
    await sweep.pass(settings)
    expect(sent).toEqual([])
    expect(sweep.entries(settings)[0].state).toBe('cancelled')
  })

  it('ends the streak once the agent worked and stopped without a new limit', async () => {
    const pane: Pane = { row: row(), screen: [LIMIT] }
    const { sweep, advance, memos } = setup([pane])
    await sweep.pass(settings)
    advance(12 * 60_000)
    await sweep.pass(settings)
    expect(memos.get('tab-1:leaf-1')?.tries).toBe(1)
    pane.row = row({ working: true, updatedAt: NOW + 12 * 60_000 })
    await sweep.pass(settings)
    pane.row = row({ working: false, updatedAt: NOW + 13 * 60_000 })
    pane.screen = ['done, all green', '> ']
    await sweep.pass(settings)
    expect(memos.has('tab-1:leaf-1')).toBe(false)
  })

  it('resumes now on request without spending a try', async () => {
    const pane: Pane = { row: row(), screen: [LIMIT] }
    const { sweep, sent, memos } = setup([pane])
    await sweep.pass(settings)
    expect(await sweep.resumeNow('tab-1:leaf-1', settings)).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(memos.get('tab-1:leaf-1')?.tries).toBe(0)
  })

  it('dismisses the Codex model-switch menu once per appearance, and never for Claude', async () => {
    const menu = ['Approaching rate limits', '  2. Keep current model']
    const codex: Pane = { row: row(), screen: menu }
    const claude: Pane = { row: row({ paneKey: 'b:1', agent: 'claude' }), screen: menu }
    const { sweep, dismissed } = setup([codex, claude])
    await sweep.pass(settings)
    await sweep.pass(settings)
    expect(dismissed).toEqual(['tab-1:leaf-1'])
    const leave = setup([{ row: row(), screen: menu }])
    await leave.sweep.pass(readLimitResumeSettings({ forkLimitResumeCodexSwitchPrompt: 'leave' }))
    expect(leave.dismissed).toEqual([])
  })
})
