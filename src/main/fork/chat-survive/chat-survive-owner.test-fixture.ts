// SLRM-1394 test fixture: an app process reduced to what matters for a chat-survive broker. Run
// under tsx. It plans and spawns the broker exactly as the app would (detached, with a report
// channel), around upstream's real provider supervisor running FIXTURE_PROVIDER, then relays its
// own stdin to the broker and the broker's stdout to its own. Its first stderr line is the broker's
// identity as JSON; it ends with `exit <code> <signal>` when the broker exits.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnProcess } from '@orca/process-host'
import { createProviderSpawnSpec } from '../../provider-process/provider-process-supervisor'
import { chatSurviveSocketDir, planChatSurviveBrokerSpawn } from './chat-survive-launch'

const provider = process.env.FIXTURE_PROVIDER ?? ''
const orphanTimeoutMs = Number(process.env.FIXTURE_ORPHAN_TIMEOUT_MS ?? '60000')
const socketBase = process.env.FIXTURE_SOCKET_BASE
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

const supervisor = createProviderSpawnSpec(
  { command: process.execPath, args: ['-e', provider] },
  process.env,
  process.platform
)
const plan = planChatSurviveBrokerSpawn(
  {
    program: supervisor.program,
    args: supervisor.args,
    env: supervisor.env,
    cwd: supervisor.cwd,
    detached: supervisor.detached
  },
  {
    entryPath: join(import.meta.dirname, 'chat-survive-broker-entry.ts'),
    socketDir: chatSurviveSocketDir(socketBase),
    orphanTimeoutMs
  }
)
if (!plan) {
  process.stderr.write('{"error":"no plan"}\n')
  process.exit(2)
}
const broker = spawnProcess({
  ...plan.spawn,
  // The broker is a TypeScript file here; the app runs the built JavaScript.
  args: ['--import', tsxLoader, ...(plan.spawn.args ?? [])],
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
})
broker.on('message', () => {})
broker.once('spawn', () => {
  process.stderr.write(
    `${JSON.stringify({ brokerPid: broker.pid, socketPath: plan.socketPath, token: plan.token })}\n`
  )
})
process.stdin.pipe(broker.stdin)
broker.stdout.pipe(process.stdout)
broker.stderr.pipe(process.stderr)
for (const stream of [broker.stdin, broker.stdout, broker.stderr, process.stdout, process.stderr]) {
  stream.on('error', () => {})
}
broker.once('exit', (code, signal) => {
  process.stderr.write(`exit ${code} ${signal}\n`, () => process.exit(0))
})
