// A stand-in Claude Code CLI for command-guards-native-chat.test.ts: it speaks the stream-json
// control protocol, and on the first user message asks the SDK's PreToolUse hook about a force
// push, then writes the hook's answer to the file named by the first argument after `--`.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const answerFile = process.env.GUARD_FAKE_ANSWER_FILE
const say = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
let hookIds = []
let asked = false
const sessionId =
  process.argv
    .find((arg) => arg.startsWith('--session-id=') || arg.startsWith('--resume='))
    ?.split('=')[1] ?? 'fake-session'

createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'control_request') {
    const subtype = frame.request.subtype
    if (subtype === 'initialize') {
      hookIds = frame.request.hooks?.PreToolUse?.[0]?.hookCallbackIds ?? []
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
  } else if (frame.type === 'control_response' && frame.response?.request_id === 'guard-1') {
    appendFileSync(answerFile, `${JSON.stringify(frame.response.response ?? null)}\n`)
    say({
      type: 'assistant',
      session_id: sessionId,
      uuid: 'reply',
      parent_tool_use_id: null,
      message: {
        id: 'reply',
        role: 'assistant',
        type: 'message',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    })
    say({
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      uuid: 'result',
      is_error: false,
      result: 'done',
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: []
    })
  } else if (frame.type === 'user' && !asked) {
    asked = true
    if (hookIds.length === 0) {
      appendFileSync(answerFile, 'null\n')
      return
    }
    say({
      type: 'control_request',
      request_id: 'guard-1',
      request: {
        subtype: 'hook_callback',
        callback_id: hookIds[0],
        tool_use_id: 'tool-1',
        input: {
          hook_event_name: 'PreToolUse',
          session_id: sessionId,
          transcript_path: '',
          cwd: process.cwd(),
          tool_name: 'Bash',
          tool_input: { command: 'git push --force origin main' },
          tool_use_id: 'tool-1'
        }
      }
    })
  }
})
