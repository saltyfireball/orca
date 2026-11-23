// A stand-in Claude Code CLI for command-guards-read-only.test.ts (BAD-795). On the first user
// message it asks every PreToolUse callback the launch registered about each case in
// GUARD_FAKE_CASES (as Claude Code asks every matcher that matches the tool), raises one permission
// prompt, and writes the launch arguments, the registered hooks and all the answers to GUARD_FAKE_OUT.
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const cases = JSON.parse(readFileSync(process.env.GUARD_FAKE_CASES, 'utf8'))
const say = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const sessionId =
  process.argv
    .find((arg) => arg.startsWith('--session-id=') || arg.startsWith('--resume='))
    ?.split('=')[1] ?? 'fake-session'
const waiting = new Map()
let hooks = {}
let asked = 0

function ask(request) {
  asked += 1
  const id = `fake-${asked}`
  say({ type: 'control_request', request_id: id, request })
  return new Promise((resolve) => waiting.set(id, resolve))
}

async function run() {
  const results = []
  for (const [index, { tool, input }] of cases.entries()) {
    const answers = []
    for (const matcher of hooks.PreToolUse ?? []) {
      if (matcher.matcher && !new RegExp(`^(?:${matcher.matcher})$`).test(tool)) {
        continue
      }
      for (const callback of matcher.hookCallbackIds) {
        answers.push(
          await ask({
            subtype: 'hook_callback',
            callback_id: callback,
            tool_use_id: `tool-${index}`,
            input: {
              hook_event_name: 'PreToolUse',
              session_id: sessionId,
              transcript_path: '',
              cwd: process.cwd(),
              tool_name: tool,
              tool_input: input,
              tool_use_id: `tool-${index}`
            }
          })
        )
      }
    }
    results.push(answers)
  }
  const prompt = await Promise.race([
    ask({
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'orca bot list' },
      tool_use_id: 'prompt-1'
    }),
    new Promise((resolve) => setTimeout(() => resolve('waiting'), 1500))
  ])
  writeFileSync(
    process.env.GUARD_FAKE_OUT,
    JSON.stringify({ argv: process.argv.slice(2), hooks, results, prompt })
  )
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'control_request') {
    const subtype = frame.request.subtype
    if (subtype === 'initialize') {
      hooks = frame.request.hooks ?? {}
    }
    say({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: frame.request_id,
        response:
          subtype === 'get_settings'
            ? { model: 'claude-sonnet-5', permissionMode: 'default' }
            : { commands: [], models: [], capabilities: ['msg_lifecycle_v1'] }
      }
    })
    if (subtype === 'initialize') {
      say({
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        uuid: 'init',
        model: 'claude-sonnet-5'
      })
    }
  } else if (frame.type === 'control_response') {
    const answer = waiting.get(frame.response?.request_id)
    waiting.delete(frame.response?.request_id)
    answer?.(frame.response.response ?? null)
  } else if (frame.type === 'user' && asked === 0) {
    void run()
  }
})
