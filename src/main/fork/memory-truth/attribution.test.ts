import { describe, expect, it } from 'vitest'
import {
  attributeForkProcessTrees,
  classifyForkProcess,
  type ForkAttributionInput,
  type ForkSessionRoot,
  type ForkStickyEntry
} from './attribution'
import type { ForkProcRow } from './process-table'

const MB = 1024 * 1024

/** [pid, ppid, pgid, name, MB] */
type Spec = [number, number, number, string, number]

function table(specs: Spec[]): Pick<ForkAttributionInput, 'byPid' | 'childrenOf'> {
  const byPid = new Map<number, ForkProcRow>()
  const childrenOf = new Map<number, number[]>()
  for (const [pid, ppid, pgid, name, mb] of specs) {
    byPid.set(pid, { pid, ppid, pgid, name, cpu: 1, memory: mb * MB })
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid])
  }
  return { byPid, childrenOf }
}

const APP = 100
const DAEMON = 200
const agentNames = new Set(['claude', 'codex'])

function run(
  specs: Spec[],
  roots: ForkSessionRoot[],
  sticky: ReadonlyMap<number, ForkStickyEntry> = new Map()
) {
  return attributeForkProcessTrees({
    ...table(specs),
    roots,
    electronPids: new Set([APP, 101, 102]),
    appPid: APP,
    daemonPid: DAEMON,
    agentNames,
    sticky
  })
}

const terminal = (id: string, pid: number, worktreeId = 'wt-1'): ForkSessionRoot => ({
  key: `terminal:${id}`,
  kind: 'terminal',
  sessionId: id,
  worktreeId,
  provider: null,
  pid
})
const chat = (id: string, pid: number, worktreeId = 'wt-1'): ForkSessionRoot => ({
  key: `chat:${id}`,
  kind: 'chat',
  sessionId: id,
  worktreeId,
  provider: 'claude',
  pid
})

// The app, two Electron helpers, a git child of the app, and the terminal host.
const BASE: Spec[] = [
  [1, 0, 1, 'launchd', 0],
  [APP, 1, APP, 'orca', 300],
  [101, APP, APP, 'orca helper (renderer)', 400],
  [102, APP, APP, 'orca helper (gpu)', 100],
  [103, APP, APP, 'git', 20],
  [DAEMON, 1, DAEMON, 'node', 50]
]

describe('attributeForkProcessTrees', () => {
  it('counts a daemon-owned terminal tree whole, split into shells, agent and tools', () => {
    const result = run(
      [
        ...BASE,
        [300, DAEMON, 300, 'zsh', 5],
        [301, 300, 301, 'claude', 600],
        [302, 301, 301, 'node', 150],
        [303, 302, 301, 'python3', 40]
      ],
      [terminal('t1', 300)]
    )
    const [session] = result.sessions
    expect(session.processCount).toBe(4)
    expect(session.memory).toBe(795 * MB)
    expect(session.breakdown).toEqual({
      agent: 600 * MB,
      tools: 190 * MB,
      shells: 5 * MB,
      other: 0
    })
    // The terminal host is the app's; its PTY children are not.
    expect(result.app.terminalHost).toBe(50 * MB)
  })

  it('counts a native chat: the provider is the agent, its MCP servers are tools', () => {
    const result = run(
      [
        ...BASE,
        [400, APP, 400, 'claude', 900],
        [401, 400, 400, 'node', 120],
        [402, 400, 400, 'uv', 30]
      ],
      [chat('c1', 400)]
    )
    const [session] = result.sessions
    expect(session.memory).toBe(1050 * MB)
    expect(session.breakdown.agent).toBe(900 * MB)
    expect(session.breakdown.tools).toBe(150 * MB)
    // The chat ran under the app but is not the app's helper memory.
    expect(result.app.helpers).toBe(20 * MB)
  })

  it('treats a script runtime right under a chat supervisor as the agent', () => {
    const result = run(
      [
        ...BASE,
        [500, APP, 500, 'supervisor', 10],
        [501, 500, 500, 'node', 700],
        [502, 501, 500, 'node', 80]
      ],
      [chat('c2', 500)]
    )
    expect(result.sessions[0].breakdown).toEqual({
      agent: 710 * MB,
      tools: 80 * MB,
      shells: 0,
      other: 0
    })
  })

  it("finds a reparented orphan through last sweep's sticky map", () => {
    const first = run(
      [
        ...BASE,
        [300, DAEMON, 300, 'zsh', 5],
        [301, 300, 301, 'claude', 600],
        [302, 301, 302, 'node', 200]
      ],
      [terminal('t1', 300)]
    )
    // The agent exits; its MCP server (own process group) is reparented to launchd.
    const second = run(
      [...BASE, [300, DAEMON, 300, 'zsh', 5], [302, 1, 302, 'node', 200]],
      [terminal('t1', 300)],
      first.sticky
    )
    const [session] = second.sessions
    expect(session.memory).toBe(205 * MB)
    expect(session.orphanCount).toBe(1)
    expect(session.breakdown.tools).toBe(200 * MB)
    expect(second.sticky.get(302)?.key).toBe('terminal:t1')
  })

  it('does not reuse a sticky entry once the pid belongs to another program', () => {
    const sticky = new Map<number, ForkStickyEntry>([
      [302, { key: 'terminal:t1', name: 'node', category: 'tools' }]
    ])
    const result = run(
      [...BASE, [300, DAEMON, 300, 'zsh', 5], [302, 1, 302, 'postgres', 200]],
      [terminal('t1', 300)],
      sticky
    )
    expect(result.sessions[0].memory).toBe(5 * MB)
  })

  it('finds an orphan never seen before by the process group a session leads', () => {
    const result = run(
      [
        ...BASE,
        [300, DAEMON, 300, 'zsh', 5],
        [301, 300, 301, 'claude', 600],
        [310, 1, 301, 'node', 90]
      ],
      [terminal('t1', 300)]
    )
    expect(result.sessions[0].memory).toBe(695 * MB)
    expect(result.sessions[0].orphanCount).toBe(1)
  })

  it("never claims an orphan in the app's or launchd's process group", () => {
    const result = run(
      [...BASE, [300, DAEMON, 300, 'zsh', 5], [320, 1, APP, 'node', 90], [321, 1, 1, 'node', 70]],
      [terminal('t1', 300)]
    )
    expect(result.sessions[0].memory).toBe(5 * MB)
  })

  it('fences the app: a root that is an Electron pid counts nothing', () => {
    const result = run(BASE, [terminal('bad', APP)])
    expect(result.sessions[0].memory).toBe(0)
    expect(result.app.electron).toBe(800 * MB)
  })

  it('counts a process in two overlapping trees once, for the first root', () => {
    const specs: Spec[] = [...BASE, [300, DAEMON, 300, 'zsh', 5], [301, 300, 300, 'claude', 600]]
    const result = run(specs, [terminal('outer', 300), chat('inner', 301)])
    expect(result.sessions.map((s) => s.memory)).toEqual([605 * MB, 0])
  })

  it('splits the app into Electron, helpers and the terminal host, and lists its pids', () => {
    const result = run([...BASE, [210, DAEMON, 210, 'stale-tool', 30]], [])
    expect(result.app).toEqual({
      total: 900 * MB,
      electron: 800 * MB,
      helpers: 20 * MB,
      terminalHost: 80 * MB
    })
    expect(new Set(result.appPids)).toEqual(new Set([APP, 101, 102, 103, DAEMON, 210]))
  })

  it('uses memoryOf when given (Linux PSS, Windows private bytes)', () => {
    const result = attributeForkProcessTrees({
      ...table([...BASE, [300, DAEMON, 300, 'zsh', 5]]),
      roots: [terminal('t1', 300)],
      electronPids: new Set([APP]),
      appPid: APP,
      daemonPid: null,
      agentNames,
      sticky: new Map(),
      memoryOf: () => 1
    })
    expect(result.sessions[0].memory).toBe(1)
  })
})

describe('classifyForkProcess', () => {
  const context = { isChatRoot: false, parentIsChatRoot: false, agentNames }
  it('names shells, agents, tools and the rest', () => {
    expect(classifyForkProcess('bash', null, context)).toBe('shells')
    expect(classifyForkProcess('codex', 'shells', context)).toBe('agent')
    expect(classifyForkProcess('node', 'agent', context)).toBe('tools')
    expect(classifyForkProcess('node', 'tools', context)).toBe('tools')
    expect(classifyForkProcess('vim', 'shells', context)).toBe('other')
    expect(classifyForkProcess('anything', null, { ...context, isChatRoot: true })).toBe('agent')
  })
})
