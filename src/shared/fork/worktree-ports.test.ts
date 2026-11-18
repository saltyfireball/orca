import { describe, expect, it } from 'vitest'
import {
  forkWorktreePortBlockEnv,
  forkWorktreePortWslenvEntries,
  formatForkWorktreePortBlock,
  isForkWorktreePortEnvKey,
  readForkWorktreePortsSettings
} from './worktree-ports'

describe('readForkWorktreePortsSettings', () => {
  it('is on with 10 ports from 20000-29999 by default', () => {
    expect(readForkWorktreePortsSettings(undefined)).toEqual({
      enabled: true,
      count: 10,
      from: 20000,
      to: 29999
    })
  })

  it('takes valid values and drops bad ones', () => {
    expect(
      readForkWorktreePortsSettings({
        forkWorktreePorts: false,
        forkWorktreePortsCount: 4,
        forkWorktreePortsFrom: 40000,
        forkWorktreePortsTo: 40100
      })
    ).toEqual({ enabled: false, count: 4, from: 40000, to: 40100 })
    expect(
      readForkWorktreePortsSettings({
        forkWorktreePortsCount: 0,
        forkWorktreePortsFrom: 80,
        forkWorktreePortsTo: 70000
      })
    ).toEqual({ enabled: true, count: 10, from: 20000, to: 29999 })
  })

  it('falls back to the default range when the range cannot hold one block', () => {
    expect(
      readForkWorktreePortsSettings({ forkWorktreePortsFrom: 40000, forkWorktreePortsTo: 40003 })
    ).toMatchObject({ from: 20000, to: 29999 })
  })
})

describe('worktree port env names', () => {
  it('exports ORCA_PORT, the count and one name per port', () => {
    expect(forkWorktreePortBlockEnv({ start: 21000, count: 2 })).toEqual({
      ORCA_PORT: '21000',
      ORCA_PORT_COUNT: '2',
      ORCA_PORT_0: '21000',
      ORCA_PORT_1: '21001'
    })
    expect(isForkWorktreePortEnvKey('ORCA_PORT_12')).toBe(true)
    expect(isForkWorktreePortEnvKey('ORCA_PORTAL')).toBe(false)
    expect(isForkWorktreePortEnvKey('ORCA_AGENT_HOOK_PORT')).toBe(false)
  })

  it('passes the names into WSL untranslated', () => {
    expect(
      forkWorktreePortWslenvEntries({ ORCA_PORT: '1', CONDUCTOR_PORT: '1', PATH: '/x' })
    ).toEqual(['ORCA_PORT/u', 'CONDUCTOR_PORT/u'])
  })

  it('prints the block line for orca ports', () => {
    expect(formatForkWorktreePortBlock({ enabled: true, block: { start: 20000, count: 10 } })).toBe(
      'reserved=20000-20009 (ORCA_PORT=20000, ORCA_PORT_0..9)'
    )
    expect(formatForkWorktreePortBlock({ enabled: false, block: null })).toBe('reserved=(off)')
    expect(formatForkWorktreePortBlock(null)).toBeNull()
  })
})
