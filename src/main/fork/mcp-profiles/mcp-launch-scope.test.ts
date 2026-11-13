import { afterEach, describe, expect, it } from 'vitest'
import {
  currentForkMcpLaunchScope,
  forkMcpLaunchKindOfMethod,
  forkMcpProfileParamOf,
  runInForkMcpLaunchScope,
  setForkMcpProfileCheck,
  withForkMcpLaunchScope
} from './mcp-launch-scope'

afterEach(() => setForkMcpProfileCheck(null))

const call = (method: string, params?: unknown) => ({ request: { method, params } })

describe('launch scope', () => {
  it('maps launch methods to kinds', () => {
    expect(forkMcpLaunchKindOfMethod('agent.launch')).toBe('interactive')
    expect(forkMcpLaunchKindOfMethod('worktree.create')).toBe('interactive')
    expect(forkMcpLaunchKindOfMethod('orchestration.workerStart')).toBe('worker')
    expect(forkMcpLaunchKindOfMethod('toString')).toBeUndefined()
  })

  it('reads the raw profile param', () => {
    expect(forkMcpProfileParamOf({ forkMcpProfile: ' web ' })).toBe('web')
    expect(forkMcpProfileParamOf({ forkMcpProfile: 3 })).toBeUndefined()
    expect(forkMcpProfileParamOf(null)).toBeUndefined()
  })

  it('runs launch methods in scope and leaves others alone', async () => {
    expect(withForkMcpLaunchScope(call('repo.list'), () => currentForkMcpLaunchScope())).toBe(
      undefined
    )
    const seen = await withForkMcpLaunchScope(
      call('agent.launch', { forkMcpProfile: 'web' }),
      async () => {
        await new Promise((resolve) => setImmediate(resolve))
        return currentForkMcpLaunchScope()
      }
    )
    expect(seen).toEqual({ kind: 'interactive', profile: 'web' })
  })

  it('keeps the outer kind and profile for nested launches', () => {
    const inner = runInForkMcpLaunchScope({ kind: 'worker', profile: 'quiet' }, () =>
      runInForkMcpLaunchScope({ kind: 'interactive' }, () => currentForkMcpLaunchScope())
    )
    expect(inner).toEqual({ kind: 'worker', profile: 'quiet' })
    const named = runInForkMcpLaunchScope({ kind: 'background' }, () =>
      runInForkMcpLaunchScope({ kind: 'interactive', profile: 'web' }, () =>
        currentForkMcpLaunchScope()
      )
    )
    expect(named).toEqual({ kind: 'background', profile: 'web' })
  })

  it('refuses an unknown profile once a check is installed', () => {
    const launch = call('orchestration.workerStart', { forkMcpProfile: 'nope' })
    expect(withForkMcpLaunchScope(launch, () => 'ran')).toBe('ran')
    setForkMcpProfileCheck((name) => name === 'web')
    expect(() => withForkMcpLaunchScope(launch, () => 'ran')).toThrow(/Unknown MCP profile "nope"/)
  })
})
