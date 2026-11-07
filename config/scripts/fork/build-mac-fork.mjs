// Fork macOS build: the upstream build:mac steps, then electron-builder with the fork config overlay.
// With FORK_VERSION set (CI release) the app, latest-mac.yml and the tag all carry exactly that
// version, so the -local suffix of build-mac-local.mjs is skipped. Without it this is a local build.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalBuildIdentity } from '../desktop-distribution/macos/build-mac-local.mjs'

const UPSTREAM_PACKAGE_STEP = 'node config/scripts/desktop-distribution/macos/build-mac-local.mjs'
const FORK_BUILDER_CONFIG = 'config/scripts/fork/electron-builder.fork.config.cjs'
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function readPackageJson() {
  return JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
}

/** The `pnpm run X` steps build:mac runs before upstream packaging, so the fork tracks upstream's list. */
export function buildMacPrerequisiteScripts(buildMacScript) {
  const steps = buildMacScript.split('&&').map((step) => step.trim())
  if (steps.at(-1) !== UPSTREAM_PACKAGE_STEP) {
    throw new Error(`build:mac no longer ends with "${UPSTREAM_PACKAGE_STEP}"; update FORK.md`)
  }
  return steps.slice(0, -1).map((step) => {
    const match = /^pnpm run ([\w:-]+)$/.exec(step)
    if (!match) {
      throw new Error(`Unexpected build:mac step "${step}"`)
    }
    return match[1]
  })
}

function commitIdentity() {
  return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
}

function packagingEnv(packageVersion) {
  const forkVersion = process.env.FORK_VERSION
  const env = { ...process.env }
  if (forkVersion) {
    // The release workflow stamps package.json in its build copy; refuse a build that would ship another version.
    if (packageVersion !== forkVersion) {
      throw new Error(`FORK_VERSION ${forkVersion} does not match package.json ${packageVersion}`)
    }
    delete env.ORCA_LOCAL_BUILD_VERSION
    env.ORCA_BUILD_COMMIT = commitIdentity()
    console.log(`[build:mac:fork] release version ${forkVersion}`)
    return env
  }
  const identity = getLocalBuildIdentity()
  env.ORCA_BUILD_COMMIT = identity.commit
  env.ORCA_LOCAL_BUILD_VERSION = identity.version
  console.log(`[build:mac:fork] local update version ${identity.version}`)
  return env
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const packageJson = readPackageJson()
  const env = packagingEnv(packageJson.version)
  for (const script of buildMacPrerequisiteScripts(packageJson.scripts['build:mac'])) {
    execFileSync(PNPM, ['run', script], { stdio: 'inherit' })
  }
  // Why never: under CI electron-builder publishes on its own, but the workflow uploads the assets.
  execFileSync(
    PNPM,
    ['exec', 'electron-builder', '--config', FORK_BUILDER_CONFIG, '--mac', '--publish', 'never'],
    { env, stdio: 'inherit' }
  )
}
