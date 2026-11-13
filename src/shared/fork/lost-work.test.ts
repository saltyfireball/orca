// SLRM-2096: lost work settings defaults and ref name checks.
import { describe, expect, it } from 'vitest'
import {
  LOST_WORK_CHECKS,
  LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT,
  LOST_WORK_DEFAULT_SQUASH_LOOKBACK,
  isSafeRefName,
  resolveLostWorkSettings
} from './lost-work'

describe('resolveLostWorkSettings', () => {
  it('turns every check on and asks for a folder by default', () => {
    const resolved = resolveLostWorkSettings(undefined)
    expect(LOST_WORK_CHECKS.every((check) => resolved.checks[check])).toBe(true)
    expect(resolved).toMatchObject({
      archiveFolder: '',
      defaultBranches: {},
      squashLookback: LOST_WORK_DEFAULT_SQUASH_LOOKBACK,
      pullRequestLimit: LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT
    })
  })

  it('keeps switched-off checks, valid branches and bounded numbers', () => {
    const resolved = resolveLostWorkSettings({
      checks: { stashes: false },
      defaultBranches: { a: ' develop ', b: '-bad', c: 'x..y' },
      squashLookback: 99_999,
      pullRequestLimit: -1
    })
    expect(resolved.checks.stashes).toBe(false)
    expect(resolved.checks.unmergedBranches).toBe(true)
    expect(resolved.defaultBranches).toEqual({ a: 'develop' })
    expect(resolved.squashLookback).toBe(10_000)
    expect(resolved.pullRequestLimit).toBe(LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT)
  })
})

describe('isSafeRefName', () => {
  it('refuses names git would read as options or ranges', () => {
    expect(isSafeRefName('feature/x')).toBe(true)
    for (const bad of ['', '-f', 'a..b', 'a@{1}', 'a b', 'a~1', 'a:b', 'x.lock', 'x/']) {
      expect(isSafeRefName(bad), bad).toBe(false)
    }
  })
})
