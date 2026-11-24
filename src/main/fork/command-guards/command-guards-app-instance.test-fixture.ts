// BAD-764 test fixture: one app instance with a guarded Claude chat, on the real session host, chat
// survive hooks and tab restore, so the process that registered the chat's hooks can quit and another
// can adopt the chat. Run under tsx; one JSON event per stdout line, commands on stdin:
// `ask <command>`, `status`, `start` (the early start of the guards), `quit`.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { spawnProcess } from '@orca/process-host'
import { setAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import type { ReadOnlySessionMode } from '../../bots/bot-look-around-policy'
import { openClaudeStreamJsonConnection } from '../../claude/claude-stream-json-connection'
import { openAgentSessionRecordStoreOnce } from '../../runtime/agent-session/records/agent-session-record-store-slot'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import { refreshChatSurviveLaunchReady } from '../chat-survive/chat-survive-launch-ready'
import { setChatSurviveConfigReader } from '../chat-survive/chat-survive-spawn'
import {
  attachGuardChat,
  askGuardChat,
  guardChatReady,
  guardHostDeps
} from './command-guards-chat.test-fixture'
import { installForkCommandGuards } from './command-guards-install'
import { forkCommandGuardStatus } from './command-guards-live'

const config: {
  mode: 'first' | 'adopt'
  session: string
  state: string
  scratch: string
  recordDir: string
  writerPath: string
  readerPath: string
  startGuards: boolean
  readOnly?: ReadOnlySessionMode
} = JSON.parse(process.env.GUARD_APP_CONFIG ?? '{}')

const say = (event: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}
setAppEnvironment({
  getPath: () => config.state,
  getAppPath: () => process.cwd(),
  getVersion: () => '0.0.0-test',
  isPackaged: () => false,
  onWillQuit: () => {},
  exit: (code) => process.exit(code),
  getAppMetrics: () => []
})
const entryPath = join(import.meta.dirname, '../chat-survive/chat-survive-broker-entry.ts')
// The broker entry runs from source here, so Node needs the tsx loader in front of it.
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
const start = (): void => installForkCommandGuards({ getSettings: () => ({}), getRepos: () => [] })

async function main(): Promise<void> {
  setChatSurviveConfigReader(() => ({
    enabled: true,
    recordDir: config.recordDir,
    entryPath
  }))
  await refreshChatSurviveLaunchReady(entryPath)
  if (config.startGuards) {
    start()
  }
  const deps = {
    ...guardHostDeps({
      state: config.state,
      scratch: config.scratch,
      readOnly: config.readOnly
    }),
    logger: {
      warn: (message: string, detail?: unknown) =>
        say({ ev: 'warn', message, detail: String(detail) }),
      error: (message: string, detail?: unknown) =>
        say({ ev: 'logged', message, detail: String(detail) })
    },
    openClaudeConnection: ((launch, handlers) =>
      openClaudeStreamJsonConnection(launch, handlers, (spec) =>
        spawnProcess(
          spec.args?.[0] === entryPath
            ? { ...spec, args: ['--import', tsxLoader, ...spec.args] }
            : spec
        )
      )) as typeof openClaudeStreamJsonConnection
  }
  await openAgentSessionRecordStoreOnce({
    stateDirectory: config.state,
    hostId: 'local',
    logger: deps.logger,
    legacySessionTabIds: [],
    onMaintenanceTick: () => {},
    writerPath: config.writerPath,
    readerPath: config.readerPath
  })
  const host = await ensureStructuredAgentSessionHost(deps)
  if (config.mode === 'first') {
    await attachGuardChat(host, config.session, config.state)
    await host.setSessionTabVisibility(config.session, true)
  } else {
    // What the app does with its restored chat tabs.
    await host.seedSessionTabs()
    await guardChatReady(host, config.session)
  }
  say({ ev: 'ready', owner: host.deps.store.getRecord(config.session)?.lease.ownerProcess?.pid })

  createInterface({ input: process.stdin }).on('line', (line) => {
    const at = line.indexOf(' ')
    const command = at === -1 ? line : line.slice(0, at)
    if (command === 'ask') {
      void askGuardChat(host, config.session, line.slice(at + 1)).then((answer) =>
        say({ ev: 'answer', answer })
      )
    } else if (command === 'status') {
      const { surfaces, chats } = forkCommandGuardStatus([])
      say({ ev: 'status', surfaces, chats })
    } else if (command === 'start') {
      start()
      say({ ev: 'started' })
    } else if (command === 'quit') {
      // It rejects when a provider still runs, which is the point of the hand-off; the app logs that.
      void stopStructuredAgentSessionRuntime()
        .catch(() => undefined)
        .then(() => say({ ev: 'quit' }))
    }
  })
  process.stdin.once('close', () => process.exit(0))
}

main().catch((error: unknown) => {
  say({
    ev: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error)
  })
  process.exit(1)
})
