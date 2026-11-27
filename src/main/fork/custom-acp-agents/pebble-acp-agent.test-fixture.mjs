// A made-up custom ACP agent ("pebble") for the BAD-873 tests: plain node speaking ACP over stdio.
// It records what Orca sent (argv, its folder, chosen env, every request) in PEBBLE_REPORT and
// answers like a small assistant: text and thought chunks per prompt, session/load, cancel.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const reportPath = process.env.PEBBLE_REPORT
const sessionId = process.env.PEBBLE_SESSION_ID || 'pebble-conversation-1'
const takesSystemPrompt = process.env.PEBBLE_TAKES_SYSTEM_PROMPT === '1'

const report = (entry) => {
  if (reportPath) {
    appendFileSync(reportPath, `${JSON.stringify(entry)}\n`)
  }
}
report({
  kind: 'start',
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  pid: process.pid,
  token: process.env.PEBBLE_TOKEN ?? null,
  home: process.env.ORCA_CUSTOM_AGENT_HOME ?? null
})

const send = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`)
const update = (fields) => send({ method: 'session/update', params: { sessionId, update: fields } })
let cancelled = null

async function prompt(frame) {
  const text = (frame.params.prompt ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
  if (text.includes('please fail')) {
    send({ id: frame.id, error: { code: -32001, message: 'The pebble service is unreachable.' } })
    return
  }
  if (text.includes('please wait')) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Waiting' } })
    await new Promise((resolve) => {
      cancelled = resolve
    })
    send({ id: frame.id, result: { stopReason: 'cancelled' } })
    return
  }
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Pebble ' } })
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'heard you.' } })
  send({ id: frame.id, result: { stopReason: 'end_turn' } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame.method === undefined) {
    return
  }
  report({ kind: 'request', method: frame.method, params: frame.params ?? null })
  const reply = (result) => send({ id: frame.id, result })
  switch (frame.method) {
    case 'initialize':
      return reply({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          ...(takesSystemPrompt ? { _meta: { orca: { systemPrompt: true } } } : {})
        },
        agentInfo: { name: 'pebble', version: '0.0.1' },
        authMethods: []
      })
    case 'session/new':
      return reply({ sessionId })
    case 'session/load':
      update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier' } })
      return reply({})
    case 'session/prompt':
      return void prompt(frame)
    case 'session/cancel':
      cancelled?.()
      return undefined
    default:
      if (frame.id !== undefined) {
        send({ id: frame.id, error: { code: -32601, message: 'Method not found' } })
      }
  }
})
process.stdin.on('end', () => process.exit(0))
// Never outlive a test run.
setTimeout(() => process.exit(3), 120_000).unref()
