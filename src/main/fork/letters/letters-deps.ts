// Letters and the board (FORK.md, SLRM-2389): what the service asks of this process, in one
// object, so every rule is tested with fakes and nothing here starts a process. `liveForkLetters`
// is the one wired to the running app or server. Keep electron out of this file.
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  readForkLettersSettings,
  type ForkLetterParty,
  type ForkLettersConfig,
  type ForkLettersSettingsSource
} from '../../../shared/fork/letters'
import { sleeperSourcesFromPs } from '../../../shared/fork/sleepers-ps-sources'
import type { ForkLetterCallerClaim, ForkLetterChat } from '../../../shared/fork/letters-wire'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  idleRecoveryChatPort,
  idleRecoveryTerminalPort,
  type IdleRecoveryPorts,
  type IdleRecoveryTerminalRuntime
} from '../idle-recovery/idle-recovery-ports'
import { forkSleeperChatFacts } from '../sleepers/sleepers-host'
import { forkLetterChatsFromSources } from './letters-parties'
import { forkLettersStore, type ForkLettersStore } from './letters-store'

export type ForkLettersRuntime = IdleRecoveryTerminalRuntime &
  Pick<OrcaRuntimeService, 'getWorktreePs' | 'requireStore' | 'callOrchestrationWorkerServer'>

export type ForkLettersDeps = {
  store: ForkLettersStore
  settings: () => ForkLettersConfig
  /** This host's chats a letter can reach. */
  chats: () => Promise<ForkLetterChat[]>
  hasChatRecord: (sessionId: string) => boolean
  ports: () => IdleRecoveryPorts
  environments: () => Promise<{ id: string; name: string }[]>
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  hostName: () => string
  now: () => number
  newId: () => string
  /** Run a delivery pass soon. */
  kick: () => void
}

/** Who asks: the command's claimed chat, a paired device, or the app's own window. */
export type ForkLettersCaller =
  | { via: 'local'; claim: ForkLetterCallerClaim }
  | { via: 'paired'; deviceId: string }
  | { via: 'window' }

export function forkLetterDeviceParty(deviceId: string, name = 'paired device'): ForkLetterParty {
  return {
    chatId: 'shell',
    kind: 'shell',
    title: 'shell',
    agent: '',
    worktreeId: null,
    host: { kind: 'device', id: deviceId, name }
  }
}

export const newForkLetterId = (): string => randomBytes(6).toString('hex')

let runtimeSlot: ForkLettersRuntime | null = null
let kickSlot: () => void = () => {}

/** Hands the service this process's runtime; the RPC handlers and the start-up hook do it. */
export function setForkLettersRuntime(runtime: ForkLettersRuntime | null | undefined): void {
  if (runtime) {
    runtimeSlot = runtime
  }
}

export function setForkLettersKick(kick: () => void): void {
  kickSlot = kick
}

function settingsSource(): ForkLettersSettingsSource {
  try {
    return (runtimeSlot?.requireStore().getSettings() ?? null) as ForkLettersSettingsSource
  } catch {
    return null
  }
}

let live: ForkLettersDeps | null = null

export function liveForkLetters(): ForkLettersDeps {
  live ??= {
    store: forkLettersStore(getCanonicalUserDataPath()),
    settings: () => readForkLettersSettings(settingsSource()),
    chats: async () => {
      if (!runtimeSlot) {
        return []
      }
      const ps = await runtimeSlot.getWorktreePs()
      return forkLetterChatsFromSources(sleeperSourcesFromPs(ps.worktrees, forkSleeperChatFacts()))
    },
    hasChatRecord: (sessionId) =>
      Boolean(getStructuredAgentSessionHost()?.deps.store.getRecord(sessionId)),
    ports: () => ({
      chat: idleRecoveryChatPort(),
      terminal: idleRecoveryTerminalPort(() => runtimeSlot)
    }),
    environments: async () =>
      (await listEnvironments(getCanonicalUserDataPath())).map((env) => ({
        id: env.id,
        name: env.name
      })),
    callEnvironment: async (environmentId, method, params, timeoutMs) => {
      if (!runtimeSlot) {
        throw new Error('This host cannot reach its paired servers yet.')
      }
      return runtimeSlot.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
    },
    hostName: () => hostname(),
    now: Date.now,
    newId: newForkLetterId,
    kick: () => kickSlot()
  }
  return live
}
