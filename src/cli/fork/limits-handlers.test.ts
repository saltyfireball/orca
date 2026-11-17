import { describe, expect, it } from 'vitest'
import type { LimitResumeEntry } from '../../shared/fork/limit-resume'
import { formatLimitsList } from './limits-handlers'

const NOW = new Date(2026, 10, 17, 10, 0).getTime()

const entry = (overrides: Partial<LimitResumeEntry>): LimitResumeEntry => ({
  id: 'tab-1:leaf-1',
  kind: 'terminal',
  paneKey: 'tab-1:leaf-1',
  worktreeId: 'wt',
  agent: 'codex',
  title: 'fix the bug',
  resetsAt: NOW + 3_600_000,
  resumeAt: new Date(2026, 10, 17, 11, 5).getTime(),
  tries: 1,
  maxTries: 5,
  state: 'parked',
  line: "You've hit your usage limit.",
  ...overrides
})

describe('formatLimitsList', () => {
  it('says when nothing is parked', () => {
    expect(formatLimitsList({ now: NOW, entries: [] })).toBe('Nothing is stopped on a usage limit.')
  })

  it('lists each entry with its tries and when it resumes', () => {
    const text = formatLimitsList({
      now: NOW,
      entries: [
        entry({}),
        entry({ id: 'chat:s1', kind: 'chat', agent: 'claude', resetsAt: null, state: 'held' }),
        entry({ id: 'c:1', state: 'exhausted' })
      ]
    })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^ID\s+AGENT\s+NAME\s+TRIES\s+WHEN$/)
    expect(lines[1]).toMatch(/1\/5\s+resumes at 11:05$/)
    expect(lines[2]).toMatch(/-\s+held: someone is typing \(due 11:05\)$/)
    expect(lines[3]).toMatch(/waits for you \(5 resumes in a row\)$/)
  })
})
