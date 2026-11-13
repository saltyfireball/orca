// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ForkUpdateInstallWait,
  ForkUpdateInstallWaitApi
} from '../../../../shared/fork/update-install-wait'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import { ForkUpdateCardContent, forkUpdateWaitingCard } from './ForkUpdateWaitingContent'
import { useForkUpdateInstallWait } from './use-fork-update-install-wait'

type Listeners = {
  changed: ((wait: ForkUpdateInstallWait | null) => void)[]
  released: (() => void)[]
}

function installBridge(initial: ForkUpdateInstallWait | null) {
  const listeners: Listeners = { changed: [], released: [] }
  const bridge: ForkUpdateInstallWaitApi = {
    get: vi.fn(async () => initial),
    installNow: vi.fn(async () => undefined),
    stopWaiting: vi.fn(async () => undefined),
    onChanged: (callback) => {
      listeners.changed.push(callback)
      return () => listeners.changed.splice(listeners.changed.indexOf(callback), 1)
    },
    onReleased: (callback) => {
      listeners.released.push(callback)
      return () => listeners.released.splice(listeners.released.indexOf(callback), 1)
    }
  }
  Object.assign(window, { api: { forkUpdateInstallWait: bridge } })
  return { bridge, listeners }
}

const downloaded: UpdateStatus = { state: 'downloaded', version: '1.2.3' }

function Probe({ onReleased }: { onReleased: () => void }): React.JSX.Element {
  const wait = useForkUpdateInstallWait(onReleased)
  return (
    forkUpdateWaitingCard(downloaded, wait, () => undefined) ?? <p data-testid="normal">normal</p>
  )
}

afterEach(() => {
  cleanup()
  Object.assign(window, { api: undefined })
})

describe('update card while the restart guard waits', () => {
  it('renders the normal card when nothing waits or the update is not downloaded', () => {
    installBridge(null)
    const wait = { total: 2, remaining: 2 }
    expect(forkUpdateWaitingCard(downloaded, null, () => undefined)).toBeNull()
    expect(
      forkUpdateWaitingCard({ state: 'downloading', version: '1', percent: 5 }, wait, () => {})
    ).toBeNull()
    expect(
      forkUpdateWaitingCard({ ...downloaded, installing: true }, wait, () => undefined)
    ).toBeNull()
  })

  it('shows the count, counts down and answers Restart Now and Stop Waiting', async () => {
    const { bridge, listeners } = installBridge({ total: 2, remaining: 2 })
    const view = render(<Probe onReleased={vi.fn()} />)
    expect(await view.findByText('Waiting for 2 chats')).toBeTruthy()
    expect(view.getByText(/0 of 2 chats finished/)).toBeTruthy()

    act(() => listeners.changed.forEach((callback) => callback({ total: 2, remaining: 1 })))
    expect(view.getByText('Waiting for 1 chat')).toBeTruthy()
    expect(view.getByText(/1 of 2 chats finished/)).toBeTruthy()

    fireEvent.click(view.getByText('Restart Now'))
    expect(bridge.installNow).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByText('Stop Waiting'))
    expect(bridge.stopWaiting).toHaveBeenCalledTimes(1)

    act(() => listeners.changed.forEach((callback) => callback(null)))
    expect(view.getByTestId('normal')).toBeTruthy()
  })

  it('runs the release callback when the guard drops the install', async () => {
    const { listeners } = installBridge(null)
    const onReleased = vi.fn()
    const view = render(<Probe onReleased={onReleased} />)
    await act(async () => undefined)
    act(() => listeners.released.forEach((callback) => callback()))
    expect(onReleased).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(listeners.released).toHaveLength(0)
    expect(listeners.changed).toHaveLength(0)
  })

  it('does nothing without the desktop bridge', () => {
    Object.assign(window, { api: {} })
    const view = render(<Probe onReleased={vi.fn()} />)
    expect(view.getByTestId('normal')).toBeTruthy()
  })

  it('swaps the card body for the waiting view only while the guard waits', () => {
    installBridge(null)
    const body = <p data-testid="normal">normal</p>
    const view = render(
      <ForkUpdateCardContent status={downloaded} wait={null} onCollapse={() => undefined}>
        {body}
      </ForkUpdateCardContent>
    )
    expect(view.getByTestId('normal')).toBeTruthy()
    const onCollapse = vi.fn()
    view.rerender(
      <ForkUpdateCardContent
        status={downloaded}
        wait={{ total: 3, remaining: 1 }}
        onCollapse={onCollapse}
      >
        {body}
      </ForkUpdateCardContent>
    )
    expect(view.queryByTestId('normal')).toBeNull()
    expect(view.getByText('Waiting for 1 chat')).toBeTruthy()
    fireEvent.click(view.getByLabelText('Minimize to status bar'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
