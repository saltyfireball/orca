// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORK_RELEASE_REPO } from '../../../../shared/fork/fork-release-repo'
import type { ForkSyncStatus } from '../../../../shared/fork/fork-sync-status'

const settings: { current: Record<string, unknown> } = { current: {} }

vi.mock('../../store/index', () => ({
  useAppStore: <T,>(select: (state: { settings: Record<string, unknown> }) => T): T =>
    select({ settings: settings.current })
}))

const { ForkSyncStatusNotice } = await import('./ForkSyncStatusNotice')

const RUN = `https://github.com/${FORK_RELEASE_REPO}/actions/runs/9`

function status(overrides: Partial<ForkSyncStatus>): ForkSyncStatus {
  return {
    state: 'conflict',
    reason: 'Rebasing the fork commits onto v1.4.260 stopped on conflicts.',
    upstreamVersion: '1.4.260',
    forkBaseVersion: '1.4.258',
    conflicts: ['src/a.ts', 'src/b.ts'],
    since: new Date().toISOString(),
    runUrl: RUN,
    checkedAt: new Date().toISOString(),
    ...overrides
  }
}

function installBridge(value: ForkSyncStatus | null) {
  const get = vi.fn(async () => value)
  Object.assign(window, { api: { forkSyncStatus: { get } } })
  return get
}

beforeEach(() => {
  settings.current = {}
})

afterEach(() => {
  cleanup()
})

describe('ForkSyncStatusNotice', () => {
  it('names the versions, the conflict count, the reason and the run', async () => {
    installBridge(status({}))
    const view = render(<ForkSyncStatusNotice updateState="not-available" />)
    await waitFor(() => expect(view.container.textContent).toContain('hit conflicts in 2 files'))
    expect(view.container.textContent).toContain('still on upstream 1.4.258')
    expect(view.container.textContent).toContain('stopped on conflicts.')
    expect(view.getByRole('link').getAttribute('href')).toBe(RUN)
  })

  it('shows nothing when the fork is in sync', async () => {
    const get = installBridge(status({ state: 'in-sync', since: null }))
    const view = render(<ForkSyncStatusNotice updateState="not-available" />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(view.container.textContent).toBe('')
  })

  it('never reads the status with the notice switched off', () => {
    settings.current = { forkSyncNotice: false }
    const get = installBridge(status({}))
    const view = render(<ForkSyncStatusNotice updateState="not-available" />)
    expect(get).not.toHaveBeenCalled()
    expect(view.container.textContent).toBe('')
  })

  it('waits for the update check to settle before reading', () => {
    const get = installBridge(status({}))
    render(<ForkSyncStatusNotice updateState="checking" />)
    expect(get).not.toHaveBeenCalled()
  })
})
