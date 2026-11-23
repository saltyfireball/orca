// @vitest-environment happy-dom
// BAD-681: a crew row's details name the worker's retry, its try number, reason and state.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CrewFrame,
  type OrchestrationCrewRow
} from '../../../../shared/orchestration/orchestration-crew'
import { CrewRowDetails } from '../../components/orchestration-crew/CrewRowDetails'

afterEach(cleanup)

function row(forkRetry?: OrchestrationCrewRow['forkRetry']): OrchestrationCrewRow {
  return {
    partyKey: '["host","dispatch:ctx_1"]',
    role: 'worker',
    label: 'Port the importer',
    agentKind: 'claude',
    status: 'done',
    task: { title: 'Port the importer', state: 'ready' },
    ...(forkRetry ? { forkRetry } : {})
  }
}

/** The row as the host sends it and the crew subscription parses it, then rendered. */
function retryLine(forkRetry: OrchestrationCrewRow['forkRetry']) {
  const frame = CrewFrame.safeParse({ type: 'rows', section: 'managing', rows: [row(forkRetry)] })
  if (!frame.success || frame.data.type !== 'rows') {
    throw new Error('the crew frame did not parse')
  }
  const view = render(<CrewRowDetails row={frame.data.rows[0]!} />)
  return view.container.querySelector('[data-retry-state]')
}

describe('the crew row of a retried worker', () => {
  it('shows a waiting retry with its try, time and reason', () => {
    const dueAt = new Date(2026, 10, 23, 14, 5).toISOString()
    const line = retryLine({
      attempt: 1,
      reason: 'the worker process exited',
      state: 'waiting',
      side: 'ended',
      dueAt
    })
    expect(line?.getAttribute('data-retry-state')).toBe('waiting')
    expect(line?.textContent).toBe(
      `Retry 1 waits until ${new Date(dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: the worker process exited`
    )
  })

  it('shows a restart on the worker that ended and on the worker it started', () => {
    expect(
      retryLine({ attempt: 2, reason: 'a provider error', state: 'restarted', side: 'ended' })
        ?.textContent
    ).toBe('Restarted as retry 2: a provider error')
    expect(
      retryLine({ attempt: 2, reason: 'a provider error', state: 'restarted', side: 'restart' })
        ?.textContent
    ).toBe('Retry 2, started after: a provider error')
  })

  it('shows that Orca gave up, and why', () => {
    const line = retryLine({
      attempt: 2,
      reason: 'the worker process exited',
      state: 'gave-up',
      side: 'ended',
      detail: 'the limit was reached'
    })
    expect(line?.textContent).toBe(
      'Gave up at retry 2 (the limit was reached): the worker process exited'
    )
    expect(line?.className).toContain('text-destructive')
  })

  it('adds no line for a worker without a retry', () => {
    expect(retryLine(undefined)).toBeNull()
  })
})
