import { describe, expect, it } from 'vitest'
import { commandFromShellFence, isRunnableShellFence } from './shell-fence'

describe('isRunnableShellFence', () => {
  it('accepts shell languages regardless of case and padding', () => {
    expect(isRunnableShellFence('sh')).toBe(true)
    expect(isRunnableShellFence('bash')).toBe(true)
    expect(isRunnableShellFence(' ZSH ')).toBe(true)
    expect(isRunnableShellFence('Shell')).toBe(true)
    expect(isRunnableShellFence('console')).toBe(true)
  })

  it('rejects other or missing languages', () => {
    expect(isRunnableShellFence('ts')).toBe(false)
    expect(isRunnableShellFence('powershell')).toBe(false)
    expect(isRunnableShellFence('')).toBe(false)
    expect(isRunnableShellFence(undefined)).toBe(false)
    expect(isRunnableShellFence(null)).toBe(false)
  })
})

describe('commandFromShellFence', () => {
  it('keeps a shell fence body without its trailing newline', () => {
    expect(commandFromShellFence('git status\ngit log -1\n', 'bash')).toBe('git status\ngit log -1')
    expect(commandFromShellFence('ls -la\r\n\r\n', 'sh')).toBe('ls -la')
  })

  it('keeps only prompt lines of a console fence, without the prompt', () => {
    expect(commandFromShellFence('$ echo hi\nhi\n$ pwd\n/home/me\n# comment\n', 'console')).toBe(
      'echo hi\npwd'
    )
  })

  it('returns null when nothing is left to run', () => {
    expect(commandFromShellFence('output only\n', 'console')).toBeNull()
    expect(commandFromShellFence('  \n\n', 'bash')).toBeNull()
    expect(commandFromShellFence('echo hi', 'python')).toBeNull()
  })
})
