import { afterEach, describe, expect, it } from 'vitest'
import {
  forkWorkerTurnStartedAt,
  noteForkWorkerTurn,
  resetForkWorkerTurns
} from './worker-cleanup-activity'

afterEach(() => resetForkWorkerTurns())

describe('worker cleanup turn record', () => {
  it('records when a turn starts, not each working update', () => {
    expect(forkWorkerTurnStartedAt('p')).toBeUndefined()
    noteForkWorkerTurn('p', true, 100)
    noteForkWorkerTurn('p', true, 200)
    expect(forkWorkerTurnStartedAt('p')).toBe(100)
    noteForkWorkerTurn('p', false, 300)
    expect(forkWorkerTurnStartedAt('p')).toBe(100)
    noteForkWorkerTurn('p', true, 400)
    expect(forkWorkerTurnStartedAt('p')).toBe(400)
  })

  it('keeps panes apart and drops the oldest past its cap', () => {
    noteForkWorkerTurn('first', true, 1)
    for (let i = 0; i < 2048; i++) {
      noteForkWorkerTurn(`pane-${i}`, true, 2)
    }
    expect(forkWorkerTurnStartedAt('first')).toBeUndefined()
    expect(forkWorkerTurnStartedAt('pane-2047')).toBe(2)
  })
})
