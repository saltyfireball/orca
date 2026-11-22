import { describe, expect, it, vi } from 'vitest'
import { forkAutoContinueChats, type AutoContinueSources } from './auto-continue-chats'

vi.mock(
  '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-custody',
  () => ({
    structuredWorkerOwesWork: (_db: unknown, record: { sessionId: string }) =>
      record.sessionId === 'worker'
  })
)

function sources(settings: unknown): AutoContinueSources {
  const rows = ['worker', 'automation', 'person'].map((sessionId) => ({
    sessionId,
    recordedAt: 100
  }))
  return {
    settings: () => settings,
    list: async () => rows as never,
    record: (sessionId) => ({ sessionId }) as never,
    orchestrationDb: () => null,
    automationRuns: () => [
      { chatSessionId: 'automation', status: 'dispatched', createdAt: 10, dispatchedAt: 20 },
      { chatSessionId: 'person', status: 'completed', createdAt: 10, dispatchedAt: 20 }
    ]
  }
}

describe('forkAutoContinueChats', () => {
  it('leaves a persons own chat to the restart offer by default', async () => {
    expect(await forkAutoContinueChats(sources({}))).toEqual(['worker', 'automation'])
    expect(await forkAutoContinueChats(sources(null))).toEqual(['worker', 'automation'])
  })

  it('continues every chat when the interactive setting is on', async () => {
    expect(await forkAutoContinueChats(sources({ forkAutoContinueInteractive: true }))).toBe(
      undefined
    )
  })
})
