// @vitest-environment happy-dom
import type React from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { TooltipProvider } = await import('@/components/ui/tooltip')
const { useAppStore } = await import('@/store')
const { useAgentBucketCounts } =
  await import('@/components/dashboard/bucket-counts/useAgentBucketCounts')
const { botRefKey } = await import('@/lib/bot-hosts')
const { readPublishedBotNeedsYou } = await import('@/components/bots/bot-needs-you-published')
const { BotRowAndPanel, gardener, sceneStore, selectGardener, setupScene } =
  await import('./bot-needs-you-test-kit')

const initial = useAppStore.getState()
/** Every host read waits for it. */
let landed: Promise<void> = Promise.resolve()

type Call = (request: { method: string }) => Promise<unknown>
let api: { runtime: { call: Call }; [name: string]: unknown }

beforeEach(() => {
  landed = Promise.resolve()
  api = { runtime: { call: async () => ({ ok: false, error: { code: 'x', message: 'x' } }) } }
  // Any other bridge call answers nothing, and any subscription stops quietly.
  const deep: unknown = new Proxy(() => () => {}, {
    get: (_target, name) => (name === 'then' ? undefined : deep),
    apply: () => new Promise(() => {})
  })
  const bridge = new Proxy(api, { get: (target, name) => target[String(name)] ?? deep })
  Reflect.set(window, 'api', bridge)
})
afterEach(() => {
  cleanup()
  useAppStore.setState(initial, true)
  Reflect.deleteProperty(window, 'api')
})

/** What the dashboard, the status bar and its popover count: agents in the Needs you bucket. */
function AgentsWaiting(): React.JSX.Element {
  return <span data-testid="agents">{useAgentBucketCounts().attention}</span>
}

type Scene = Parameters<typeof setupScene>[0]

function show(scene: Scene, selected: boolean): void {
  setupScene(scene)
  const answer = api.runtime.call
  api.runtime = {
    ...api.runtime,
    call: async (request) => {
      await landed
      return answer(request)
    }
  }
  useAppStore.setState(sceneStore(scene, selected))
  render(
    <TooltipProvider>
      <AgentsWaiting />
      <BotRowAndPanel />
    </TooltipProvider>
  )
}

const rowCount = (): number => {
  const pill = screen.getByTestId('row').querySelector('[data-fork-bot-needs-you]')
  return pill ? Number(pill.getAttribute('data-fork-bot-needs-you')) : 0
}
const listed = (): string[] =>
  [...screen.getByTestId('panel').querySelectorAll<HTMLElement>('[data-need-key]')].map(
    (row) => row.dataset.needKey ?? ''
  )
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })

const CHAT = 'side-chat:chat-greenhouse'
const ITEM = /^item:/
const WORKER = 'worker:d-hedge'

describe('a bot row count and its panel (BAD-795)', () => {
  it.each<[string, Scene, (string | RegExp)[]]>([
    ['item only', { item: true }, [ITEM]],
    ['waiting chat only', { waitingChat: true }, [CHAT]],
    ['both', { item: true, waitingChat: true }, [CHAT, ITEM]],
    ['a worker its host knows of, and a chat', { worker: true, waitingChat: true }, [WORKER, CHAT]],
    ['background run only', { backgroundRun: true }, []],
    ['background run beside an item', { backgroundRun: true, item: true }, [ITEM]]
  ])('%s: the row says what the panel lists, selected or not', async (_name, scene, needs) => {
    show(scene, false)
    await settle()
    expect(rowCount()).toBe(needs.length)
    expect(screen.getByTestId('agents').textContent).toBe(scene.waitingChat ? '1' : '0')
    // Its picture's corner asks only for a chat the owner can answer.
    const corner = screen
      .getByTestId('row')
      .querySelector('[data-worktree-card-status-slot] .text-agent-question')
    expect(corner !== null).toBe(Boolean(scene.waitingChat))

    // Opening the bot never shows another number, not even while its panel mounts.
    const seen = new Set<number>()
    const observer = new MutationObserver(() => seen.add(rowCount()))
    observer.observe(screen.getByTestId('row'), {
      subtree: true,
      childList: true,
      attributes: true
    })
    act(() => selectGardener())
    seen.add(rowCount())
    await waitFor(() => expect(listed()).toHaveLength(needs.length))
    await settle()
    observer.disconnect()
    listed().forEach((key, index) => expect(key).toMatch(needs[index]!))
    expect([...seen]).toEqual([needs.length])

    act(() => useAppStore.setState({ activeWorktreeId: null, activeWorkspaceKey: null }))
    await settle()
    expect(rowCount()).toBe(needs.length)
  })

  it('a waiting chat is a line that opens it, in place of Nothing needs you', async () => {
    show({ waitingChat: true }, true)
    await waitFor(() => expect(listed()).toEqual([CHAT]))
    const panel = within(screen.getByTestId('panel'))
    expect(panel.queryByText(/Nothing needs you/)).toBeNull()
    expect(panel.getByText('Plan the greenhouse')).toBeTruthy()
    expect(panel.getAllByRole('button', { name: /Open/ }).length).toBeGreaterThan(0)
  })

  it('opening the bot while its reads are under way keeps the row count', async () => {
    let land = (): void => {}
    landed = new Promise((resolve) => {
      land = resolve
    })
    show({ item: true, waitingChat: true }, false)
    await settle()
    expect(rowCount()).toBe(2)
    act(() => selectGardener())
    await settle()
    expect(rowCount()).toBe(2)
    // Nothing is published for the row until the reads behind the number land.
    expect(readPublishedBotNeedsYou(botRefKey(gardener))).toBeNull()
    act(() => land())
    await waitFor(() => expect(listed()).toHaveLength(2))
    expect(rowCount()).toBe(2)
    expect(readPublishedBotNeedsYou(botRefKey(gardener))).toBe(2)
  })
})

vi.setConfig({ testTimeout: 30_000 })
