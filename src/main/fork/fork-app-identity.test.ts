import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FORK_APP_BUNDLE_ID,
  isForkPreferencesDomain,
  isForkTccResponsibleIdentifier,
  isPressAndHoldDecisionForOtherApp,
  readExecutableBundleId,
  runningForkBundleId
} from './fork-app-identity'

const root = mkdtempSync(join(tmpdir(), 'fork-app-identity-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A fake `<name>.app` with the given CFBundleIdentifier; returns its main executable path. */
function fakeApp(name: string, bundleId: string): string {
  const contents = join(root, `${name}.app`, 'Contents')
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleIdentifier</key>\n  <string>${bundleId}</string>\n</dict>\n</plist>\n`
  )
  return join(contents, 'MacOS', name)
}

const forkExec = fakeApp('Fork', FORK_APP_BUNDLE_ID)
const stockExec = fakeApp('Stock', 'com.stablyai.orca')
const bareExec = join(root, 'bin', 'node')

describe('fork app identity', () => {
  it('reads the bundle id of the app holding the executable', () => {
    expect(readExecutableBundleId(forkExec)).toBe(FORK_APP_BUNDLE_ID)
    expect(readExecutableBundleId(stockExec)).toBe('com.stablyai.orca')
    expect(readExecutableBundleId(bareExec)).toBeNull()
  })

  it('names the fork only inside the fork bundle', () => {
    expect(runningForkBundleId(forkExec)).toBe(FORK_APP_BUNDLE_ID)
    expect(runningForkBundleId(stockExec)).toBeNull()
    expect(runningForkBundleId(bareExec)).toBeNull()
    // Tests run under plain node, never inside the fork bundle, so upstream tests see stock ids.
    expect(runningForkBundleId()).toBeNull()
  })

  it('claims TCC prompts for the fork and its helper only while running as the fork', () => {
    expect(isForkTccResponsibleIdentifier(FORK_APP_BUNDLE_ID, forkExec)).toBe(true)
    expect(isForkTccResponsibleIdentifier(`${FORK_APP_BUNDLE_ID}.helper`, forkExec)).toBe(true)
    expect(isForkTccResponsibleIdentifier(`${FORK_APP_BUNDLE_ID}.other`, forkExec)).toBe(false)
    expect(isForkTccResponsibleIdentifier('com.stablyai.orca', forkExec)).toBe(false)
    expect(isForkTccResponsibleIdentifier(FORK_APP_BUNDLE_ID, stockExec)).toBe(false)
  })

  it('accepts only the exact fork preferences domain', () => {
    expect(isForkPreferencesDomain(FORK_APP_BUNDLE_ID)).toBe(true)
    expect(isForkPreferencesDomain(`${FORK_APP_BUNDLE_ID}.helper`)).toBe(false)
    expect(isForkPreferencesDomain('com.saltyfireball.orcax')).toBe(false)
    expect(isForkPreferencesDomain('com.stablyai.orca')).toBe(false)
  })

  it('redecides press-and-hold when the record belongs to the other app', () => {
    expect(isPressAndHoldDecisionForOtherApp('com.stablyai.orca', FORK_APP_BUNDLE_ID)).toBe(true)
    expect(isPressAndHoldDecisionForOtherApp(FORK_APP_BUNDLE_ID, 'com.stablyai.orca')).toBe(true)
    expect(isPressAndHoldDecisionForOtherApp(FORK_APP_BUNDLE_ID, FORK_APP_BUNDLE_ID)).toBe(false)
    // Stock-only records keep upstream's behaviour.
    expect(isPressAndHoldDecisionForOtherApp('com.stablyai.orca', 'com.stablyai.orca')).toBe(false)
    expect(isPressAndHoldDecisionForOtherApp(null, 'com.stablyai.orca')).toBe(false)
    expect(isPressAndHoldDecisionForOtherApp('com.stablyai.orca', 'com.stablyai.orca.dev')).toBe(
      false
    )
  })
})
