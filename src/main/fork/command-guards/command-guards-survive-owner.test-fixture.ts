// BAD-764 test fixture: one app instance's guarded Claude chat on the real Claude Code, over Orca's
// connection and the chat-survive hooks, so the process that registered the chat's hooks can be killed
// and another can adopt the chat. Run under tsx; one JSON event per stdout line, commands on stdin:
// `say <text>`, `quit <fence>` (the quit hook), `status`, `start` (the guards). GUARD_SURVIVE_CONFIG
// is JSON; `hang` is a chat whose guard never answers.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import { setAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { openClaudeStreamJsonConnection } from '../../claude/claude-stream-json-connection'
import { claudeReadOnlyOptions } from '../../claude/claude-structured-read-only-options'
import { forkChatSurviveAdopt } from '../chat-survive/chat-survive-adopt'
import { forkChatSurviveQuit } from '../chat-survive/chat-survive-detach'
import { refreshChatSurviveLaunchReady } from '../chat-survive/chat-survive-launch-ready'
import { setChatSurviveConfigReader } from '../chat-survive/chat-survive-spawn'
import { listCommandGuardAudit } from './command-guards-audit'
import { noteCommandGuardChatInitialized } from './command-guards-chat-registry'
import { installForkCommandGuards } from './command-guards-install'
import { forkCommandGuardStatus } from './command-guards-status'
import { forkChatGuardOptions } from './command-guards-native-chat'

const config: {
  mode: 'first' | 'adopt'
  sessionId: string
  recordDir: string
  cwd: string
  claude: string
  brokerPid?: number
  readOnly?: boolean
  startGuards?: boolean
  hang?: boolean
} = JSON.parse(process.env.GUARD_SURVIVE_CONFIG ?? '{}')
const say = (event: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}
const claudeSession = createHash('sha256')
  .update(config.sessionId)
  .digest('hex')
  .replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/, '$1-$2-4$3-8$4-$5')
const entryPath = join(import.meta.dirname, '../chat-survive/chat-survive-broker-entry.ts')
// The broker entry runs from source here, so Node needs the tsx loader in front of it.
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

// This process keeps its state beside its broker records.
setAppEnvironment({
  getPath: () => join(config.recordDir, '..', 'user-data'),
  getAppPath: () => process.cwd(),
  getVersion: () => '0.0.0-test',
  isPackaged: () => false,
  onWillQuit: () => {},
  exit: (code) => process.exit(code),
  getAppMetrics: () => []
})

const start = (): void => installForkCommandGuards({ getSettings: () => ({}), getRepos: () => [] })

type ChatOptions = Parameters<typeof openClaudeStreamJsonConnection>[0]['options'] &
  Pick<Options, 'hooks'>

function chatOptions(): ChatOptions {
  const base: ChatOptions = {
    model: 'haiku',
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    ...(config.readOnly ? claudeReadOnlyOptions() : {}),
    extraArgs: { 'replay-user-messages': null },
    ...(config.mode === 'first' ? { sessionId: claudeSession } : { resume: claudeSession })
  }
  const guarded = forkChatGuardOptions(base, config.sessionId, config.cwd)
  if (!config.hang) {
    return guarded
  }
  const never: HookCallback = () => {
    say({ ev: 'hook-hangs' })
    return new Promise(() => {})
  }
  return { ...guarded, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [never] }] } }
}

async function main(): Promise<void> {
  setChatSurviveConfigReader(() => ({ enabled: true, recordDir: config.recordDir, entryPath }))
  await refreshChatSurviveLaunchReady(entryPath)
  if (config.startGuards !== false) {
    start()
  }
  if (config.mode === 'adopt') {
    const ok = await forkChatSurviveAdopt({
      sessionId: config.sessionId,
      ownerPid: config.brokerPid ?? 0,
      platform: process.platform
    })
    say({ ev: 'adopted', ok })
  }
  const connection = await openClaudeStreamJsonConnection(
    {
      pathToClaudeCodeExecutable: config.claude,
      cwd: config.cwd,
      env: { ORCA_AGENT_SESSION_ID: config.sessionId },
      options: chatOptions()
    },
    {
      onMessage: (message) => say({ ev: message.type === 'result' ? 'result' : 'msg', message }),
      onFault: (error) => say({ ev: 'fault', message: String(error) })
    },
    (spec) =>
      spawnProcess(
        spec.args?.[0] === entryPath
          ? { ...spec, args: ['--import', tsxLoader, ...spec.args] }
          : spec
      )
  )
  say({ ev: 'pid', pid: connection.pid })
  createInterface({ input: process.stdin }).on('line', (line) => {
    const at = line.indexOf(' ')
    const command = at === -1 ? line : line.slice(0, at)
    const rest = at === -1 ? '' : line.slice(at + 1)
    if (command === 'say') {
      void connection.send({
        type: 'user',
        message: { role: 'user', content: rest },
        parent_tool_use_id: null
      })
    } else if (command === 'quit') {
      void forkChatSurviveQuit(config.sessionId, { phase: 'ready', fence: Number(rest) }).then(
        (ok) => say({ ev: 'detached', ok })
      )
    } else if (command === 'start') {
      start()
      say({ ev: 'started' })
    } else if (command === 'status') {
      const { chats, surfaces } = forkCommandGuardStatus([])
      say({ ev: 'status', chats, surfaces, audit: listCommandGuardAudit(10) })
    }
  })
  // The test is gone; its broker stops its Claude on its own.
  process.stdin.once('close', () => process.exit(0))
  const init = await connection.initializationResult()
  // As the session's startup does with the reply (claude-structured-session-startup.ts).
  noteCommandGuardChatInitialized(config.sessionId, init)
  say({ ev: 'init', init })
}

main().catch((error: unknown) => {
  say({
    ev: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error)
  })
  process.exit(1)
})
