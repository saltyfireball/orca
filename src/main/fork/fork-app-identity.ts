import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// The fork's macOS identity. Keep in sync with appId in
// config/scripts/fork/electron-builder.fork.config.cjs, the helper ids in
// config/scripts/fork/build-mac-fork.mjs and
// native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/fork/ForkTrustedOrcaApplication.swift.
// Each hook below answers only for the packaged fork, so stock builds and upstream's tests,
// which never run inside a com.saltyfireball.orca bundle, keep their stock ids.
export const FORK_APP_BUNDLE_ID = 'com.saltyfireball.orca'
export const FORK_COMPUTER_USE_BUNDLE_ID = `${FORK_APP_BUNDLE_ID}.computer-use`
// electron-builder names the Electron helper apps `<appId>.helper`.
const FORK_HELPER_BUNDLE_ID = `${FORK_APP_BUNDLE_ID}.helper`

const bundleIdByExecPath = new Map<string, string | null>()

/** CFBundleIdentifier of the .app whose Contents/MacOS holds execPath, or null. */
export function readExecutableBundleId(execPath: string): string | null {
  try {
    const plist = readFileSync(join(dirname(dirname(execPath)), 'Info.plist'), 'utf8')
    const match = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

/** The fork's bundle id when this process runs inside the packaged fork app, else null. */
export function runningForkBundleId(execPath: string = process.execPath): string | null {
  // Only a macOS app bundle has Contents/Info.plist beside Contents/MacOS, so other platforms get null.
  let bundleId = bundleIdByExecPath.get(execPath)
  if (bundleId === undefined) {
    bundleId = readExecutableBundleId(execPath)
    bundleIdByExecPath.set(execPath, bundleId)
  }
  return bundleId === FORK_APP_BUNDLE_ID ? FORK_APP_BUNDLE_ID : null
}

/** TCC names the fork or its Electron helper as responsible for prompts the fork caused. */
export function isForkTccResponsibleIdentifier(
  identifier: string,
  execPath: string = process.execPath
): boolean {
  return (
    runningForkBundleId(execPath) !== null &&
    (identifier === FORK_APP_BUNDLE_ID || identifier === FORK_HELPER_BUNDLE_ID)
  )
}

/** The fork's own preferences domain, which the press-and-hold default may write. */
export function isForkPreferencesDomain(domain: string): boolean {
  return domain === FORK_APP_BUNDLE_ID
}

/**
 * Shared mode keeps one press-and-hold record for both apps, but each app has its own
 * preferences domain. A decision recorded for the other app's domain must not stop this
 * app from deciding for its own.
 */
export function isPressAndHoldDecisionForOtherApp(
  recordedDomain: string | null,
  domain: string | null
): boolean {
  return (
    recordedDomain !== domain &&
    (domain === FORK_APP_BUNDLE_ID || recordedDomain === FORK_APP_BUNDLE_ID)
  )
}
