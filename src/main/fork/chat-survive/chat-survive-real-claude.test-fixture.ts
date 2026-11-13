// SLRM-1394 e2e fixture: one app instance's Claude chat, reduced to the agent SDK, Orca's real
// spawner (chat-survive broker around the provider supervisor) and the chat-survive hooks. Run
// under tsx with: <first|adopt> <sessionId> <recordDir> <cwd> <claude> <prompt|brokerPid>.
// It writes one JSON event per stdout line and takes commands on stdin: `quit <fence>` runs the
// quit hook, `end` ends the chat's input. A first instance never answers a permission prompt, so
// the next instance has to.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { query, type CanUseTool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { spawnProcess } from '@orca/process-host'
import { createClaudeCodeProcessSpawn } from '../../claude/claude-agent-sdk-process-spawn'
import { forkChatSurviveAdopt } from './chat-survive-adopt'
import { forkChatSurviveQuit } from './chat-survive-detach'
import { forkChatSurviveConsumed } from './chat-survive-registry'
import { refreshChatSurviveLaunchReady } from './chat-survive-launch-ready'
import { setChatSurviveConfigReader } from './chat-survive-spawn'

const [mode, sessionId = '', recordDir = '', cwd = '', claude = '', last = ''] =
  process.argv.slice(2)
const debugFile = process.env.ORCA_CHAT_SURVIVE_E2E_DEBUG
// The Claude session id, the same in every instance: the first starts it, later ones resume it, as
// Orca does, so the adopter's launch-spec check sees `--session-id` and `--resume` both.
const claudeSession = createHash('sha256')
  .update(sessionId)
  .digest('hex')
  .replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/, '$1-$2-4$3-8$4-$5')
const entryPath = join(import.meta.dirname, 'chat-survive-broker-entry.ts')
const say = (event: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

setChatSurviveConfigReader(() => ({ enabled: true, recordDir, entryPath }))
// The broker entry runs from source here, so Node needs the tsx loader in front of it.
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
const spawner = createClaudeCodeProcessSpawn(
  (spec) =>
    spawnProcess(
      spec.args?.[0] === entryPath ? { ...spec, args: ['--import', tsxLoader, ...spec.args] } : spec
    ),
  process.platform,
  { pathToClaudeCodeExecutable: claude }
)

const ended = Promise.withResolvers<void>()
async function* prompt(): AsyncGenerator<SDKUserMessage> {
  if (mode === 'first') {
    yield { type: 'user', message: { role: 'user', content: last }, parent_tool_use_id: null }
  }
  await ended.promise
}

const canUseTool: CanUseTool = (toolName, input, { toolUseID }) => {
  say({ ev: 'perm', toolName, toolUseID })
  if (mode === 'first') {
    return new Promise(() => {})
  }
  return Promise.resolve({ behavior: 'allow', updatedInput: input })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, arg] = line.split(' ')
  if (command === 'end') {
    ended.resolve()
  } else if (command === 'quit') {
    void forkChatSurviveQuit(sessionId, { phase: 'ready', fence: Number(arg) }).then((ok) =>
      say({ ev: 'detached', ok })
    )
  }
})

async function main(): Promise<void> {
  // As the app's install does before the first chat: the spawn's disk checks, ahead of it.
  await refreshChatSurviveLaunchReady(entryPath)
  if (mode === 'adopt') {
    const ownerPid = Number(last)
    const ok = await forkChatSurviveAdopt({ sessionId, ownerPid, platform: process.platform })
    say({ ev: 'adopted', ok })
    if (!ok) {
      process.exit(3)
    }
  }
  // Orca's structured launch options (CLAUDE_STRUCTURED_BASE_OPTIONS, ask mode), except that no
  // settings files load: the user's own hooks must not run inside a test.
  const session = query({
    prompt: prompt(),
    options: {
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: [],
      supportedDialogKinds: [],
      extraArgs: {
        'replay-user-messages': null,
        // ORCA_CHAT_SURVIVE_E2E_DEBUG names a Claude Code debug log, to see why a run went wrong.
        ...(debugFile ? { 'debug-file': debugFile } : {})
      },
      permissionMode: 'default',
      model: 'haiku',
      ...(mode === 'first' ? { sessionId: claudeSession } : { resume: claudeSession }),
      cwd,
      env: { ...process.env, ORCA_AGENT_SESSION_ID: sessionId },
      pathToClaudeCodeExecutable: claude,
      spawnClaudeCodeProcess: (options) => {
        const child = spawner.spawn(options)
        say({ ev: 'pid', pid: child.pid, args: options.args })
        return child
      },
      canUseTool,
      stderr: (data) => say({ ev: 'stderr', data })
    }
  })
  for await (const message of session) {
    say({ ev: 'msg', message })
    // As claude-stream-json-connection.ts does once the chat has a message.
    forkChatSurviveConsumed(spawner.managed?.child, message)
  }
  say({ ev: 'done' })
}

main().catch((error: unknown) => {
  say({ ev: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
