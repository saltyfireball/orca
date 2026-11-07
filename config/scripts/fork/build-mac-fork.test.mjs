import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FORK_APP_BUNDLE_ID,
  FORK_COMPUTER_USE_BUNDLE_ID,
  buildMacPrerequisiteScripts,
  forkPrerequisiteEnv,
  forkPrerequisiteStepArgs
} from './build-mac-fork.mjs'

const repoRoot = resolve(import.meta.dirname, '../../..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('fork build:mac steps', () => {
  it('names the computer-use helper with the fork id for every step', () => {
    const env = forkPrerequisiteEnv({ PATH: '/bin', ORCA_COMPUTER_MACOS_BUNDLE_ID: 'stock' })
    expect(env).toEqual({
      PATH: '/bin',
      ORCA_COMPUTER_MACOS_BUNDLE_ID: FORK_COMPUTER_USE_BUNDLE_ID
    })
    expect(FORK_COMPUTER_USE_BUNDLE_ID).toBe('com.saltyfireball.orca.computer-use')
  })

  it('builds the notification helper for the fork id and leaves other steps as upstream runs them', () => {
    expect(forkPrerequisiteStepArgs('build:notification-status-macos')).toEqual([
      'run',
      'build:notification-status-macos',
      '--bundle-id',
      FORK_APP_BUNDLE_ID
    ])
    expect(forkPrerequisiteStepArgs('build:computer-macos')).toEqual([
      'run',
      'build:computer-macos'
    ])
  })

  it("covers the helper steps in upstream's build:mac", () => {
    const steps = buildMacPrerequisiteScripts(JSON.parse(read('package.json')).scripts['build:mac'])
    expect(steps).toContain('build:computer-macos')
    expect(steps).toContain('build:notification-status-macos')
  })

  it('agrees on the fork bundle ids everywhere they are written', () => {
    expect(read('config/scripts/fork/electron-builder.fork.config.cjs')).toContain(
      `appId: '${FORK_APP_BUNDLE_ID}'`
    )
    expect(read('src/main/fork/fork-app-identity.ts')).toContain(
      `FORK_APP_BUNDLE_ID = '${FORK_APP_BUNDLE_ID}'`
    )
    const swift = read(
      'native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/fork/ForkTrustedOrcaApplication.swift'
    )
    expect(swift).toContain(`forkAppBundleId = "${FORK_APP_BUNDLE_ID}"`)
    expect(swift).toContain(`forkHelperBundleId = "${FORK_COMPUTER_USE_BUNDLE_ID}"`)
  })
})
