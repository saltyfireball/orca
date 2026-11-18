// Server updates (FORK.md, SLRM-2310): the updater wired to this process. Shared by the desktop
// and the headless server (orcad); keep electron out of this file.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { runProcess } from '@orca/process-host'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { pickForkReleaseVersion } from '../../../shared/fork/server-update'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { listBusyChats } from '../restart-guard/busy-chats'
import { defaultForkFetch } from './server-update-fetch'
import { spawnForkDetached } from './server-update-restart'
import { createForkServerUpdater, type ForkServerUpdater } from './server-update-service'
import type { ForkRun } from './server-update-stage'

/**
 * The restart guard's own idea of busy (FORK.md "Restart guard"), less chats that only wait on a
 * question: a turn at work, or a live sub-agent or background command. Terminal agents live in
 * the terminal daemon, which a server restart does not stop, so they never count.
 */
export function countForkBusyTurns(): number {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return 0
  }
  return listBusyChats(host.loadedSessionIds().map((id) => host.readStatusSummary(id))).filter(
    (chat) => chat.activity.kind !== 'question'
  ).length
}

/** This process's release version (orcad's own version is a build string; see the picker). */
export function forkRunningReleaseVersion(
  hostVersion: string = getAppEnvironment().getVersion()
): string {
  return pickForkReleaseVersion(hostVersion, process.env.ORCA_APP_VERSION)
}

const run: ForkRun = async (program, args) => {
  const result = await runProcess({
    program,
    args,
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 64 * 1024
  })
  return {
    code: result.timedOut ? null : result.code,
    out: `${result.stdout}${result.stderr}`
  }
}

let updater: ForkServerUpdater | null = null

export function liveForkServerUpdater(): ForkServerUpdater {
  updater ??= createForkServerUpdater({
    userDataPath: getCanonicalUserDataPath,
    version: () => getAppEnvironment().getVersion(),
    releaseVersion: () => forkRunningReleaseVersion(),
    platform: process.platform,
    arch: process.arch,
    homeDir: homedir(),
    configHome: process.env.XDG_CONFIG_HOME,
    uid: process.getuid?.() ?? null,
    busyTurns: countForkBusyTurns,
    fetch: defaultForkFetch,
    run,
    spawnDetached: spawnForkDetached,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newId: () => randomUUID()
  })
  return updater
}
