// SLRM-2096: lost work settings defaults and ref name checks.
import { describe, expect, it } from 'vitest'
import {
  LOST_WORK_CHECKS,
  LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT,
  LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS,
  LOST_WORK_DEFAULT_SQUASH_LOOKBACK,
  isSafeRefName,
  resolveLostWorkConcurrency,
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

describe('lost work scan speed settings (SLRM-2175)', () => {
  it('defaults to a 20 second pull request limit and automatic concurrency', () => {
    expect(resolveLostWorkSettings(undefined)).toMatchObject({
      pullRequestTimeoutSeconds: LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS,
      projectConcurrency: 0,
      itemConcurrency: 0
    })
    expect(LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS).toBe(20)
  })

  it('bounds what is set and never takes a zero time limit', () => {
    expect(
      resolveLostWorkSettings({
        pullRequestTimeoutSeconds: 0,
        projectConcurrency: 99,
        itemConcurrency: 1.5
      })
    ).toMatchObject({
      pullRequestTimeoutSeconds: LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS,
      projectConcurrency: 16,
      itemConcurrency: 0
    })
    expect(
      resolveLostWorkSettings({ pullRequestTimeoutSeconds: 9_999 }).pullRequestTimeoutSeconds
    ).toBe(600)
  })

  it('derives automatic concurrency from the cores and keeps what the user set', () => {
    const auto = resolveLostWorkSettings(undefined)
    expect(resolveLostWorkConcurrency(auto, 1)).toEqual({ projects: 2, items: 2 })
    expect(resolveLostWorkConcurrency(auto, 8)).toEqual({ projects: 2, items: 4 })
    expect(resolveLostWorkConcurrency(auto, 64)).toEqual({ projects: 4, items: 6 })
    expect(resolveLostWorkConcurrency(auto, Number.NaN)).toEqual({ projects: 2, items: 2 })
    const set = resolveLostWorkSettings({ projectConcurrency: 1, itemConcurrency: 12 })
    expect(resolveLostWorkConcurrency(set, 8)).toEqual({ projects: 1, items: 12 })
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
