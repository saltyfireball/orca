import { describe, expect, it } from 'vitest'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { POSIX_PROVIDER_SUPERVISOR_SCRIPT } from '../../provider-process/provider-process-supervisor'
import { chatSurviveLaunchHash } from './chat-survive-launch-hash'

function supervised(args: string[], cwd = '/work'): PipedProcessSpec {
  return {
    program: '/bin/sh',
    args: ['-e', POSIX_PROVIDER_SUPERVISOR_SCRIPT, '--', 'claude', ...args],
    cwd,
    stdio: 'pipe'
  }
}

const ENV = { ANTHROPIC_MODEL: 'haiku', ORCA_AGENT_SESSION_ID: 'sess', PATH: '/bin' }

describe('chat-survive launch hash', () => {
  it('is the same for a resume of the same launch, whatever per-run noise changed', () => {
    const first = chatSurviveLaunchHash(supervised(['--session-id', 'abc', '--model', 'x']), {
      ...ENV,
      ORCA_AGENT_SESSION_SPAWN_TOKEN: 'one',
      ORCA_AGENT_HOOK_PORT: '1000',
      XPC_SERVICE_NAME: 'application.1'
    })
    const resumed = chatSurviveLaunchHash(supervised(['--resume', 'abc', '--model', 'x']), {
      ...ENV,
      ORCA_AGENT_SESSION_SPAWN_TOKEN: 'two',
      ORCA_AGENT_HOOK_PORT: '2000',
      XPC_SERVICE_NAME: 'application.2',
      PATH: '/usr/bin:/bin'
    })
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(resumed).toBe(first)
    // The SDK writes them with `=`.
    const sdk = (flag: string) =>
      chatSurviveLaunchHash(supervised([`${flag}=abc`, '--model', 'x']), ENV)
    expect(sdk('--resume')).toBe(sdk('--session-id'))
    expect(sdk('--resume')).toBe(
      chatSurviveLaunchHash(supervised(['--resume', 'abc', '--model', 'x']), ENV)
    )
  })

  it('matches the args the SDK writes for a first launch and its resume', () => {
    // As Claude Agent SDK 0.3.284 wrote them: the resume flag comes earlier than the session id.
    const head = ['--output-format', 'stream-json', '--model', 'haiku']
    const tail = ['--permission-mode', 'default', '--include-partial-messages']
    const first = supervised([...head, ...tail, '--session-id=abc', '--replay-user-messages'])
    const resume = supervised([...head, '--resume=abc', ...tail, '--replay-user-messages'])
    expect(chatSurviveLaunchHash(resume, ENV)).toBe(chatSurviveLaunchHash(first, ENV))
    const other = supervised([...head, '--resume=xyz', ...tail, '--replay-user-messages'])
    expect(chatSurviveLaunchHash(other, ENV)).not.toBe(chatSurviveLaunchHash(first, ENV))
  })

  it('differs when the args, cwd or provider env differ', () => {
    const base = chatSurviveLaunchHash(supervised(['--model', 'x']), ENV)
    expect(chatSurviveLaunchHash(supervised(['--model', 'y']), ENV)).not.toBe(base)
    expect(chatSurviveLaunchHash(supervised(['--model', 'x'], '/other'), ENV)).not.toBe(base)
    expect(
      chatSurviveLaunchHash(supervised(['--model', 'x']), { ...ENV, ANTHROPIC_MODEL: 'opus' })
    ).not.toBe(base)
    expect(
      chatSurviveLaunchHash(supervised(['--model', 'x']), { ...ENV, CLAUDE_CONFIG_DIR: '/c' })
    ).not.toBe(base)
  })

  it('has nothing to say about a spawn that is not a provider supervisor', () => {
    expect(chatSurviveLaunchHash({ program: 'claude', args: [], stdio: 'pipe' }, ENV)).toBeNull()
  })
})
