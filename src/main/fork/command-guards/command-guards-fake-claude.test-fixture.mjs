// A stand-in Claude Code CLI for the command guard tests: it speaks the stream-json control protocol
// and, on each user message, asks the SDK's PreToolUse hooks that match about the tool call in
// `$GUARD_FAKE_ANSWER_FILE.call` (a Bash force push by default). Each ask appends one line to
// $GUARD_FAKE_ANSWER_FILE: the first denial, else the first answer, else null with no hook. As the
// real CLI 2.1.330 does (command-guards-real-claude.test.ts), a later initialize that carries hooks
// replaces the earlier ones and says so, and a callback that fails lets the call through.
// GUARD_FAKE_OLD_CLI=1 is a CLI from before that: it ignores the hooks of a later initialize.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const answerFile = process.env.GUARD_FAKE_ANSWER_FILE
const old = process.env.GUARD_FAKE_OLD_CLI === '1'
const say = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const toolCall = () =>
  existsSync(`${answerFile}.call`)
    ? JSON.parse(readFileSync(`${answerFile}.call`, 'utf8'))
    : { tool: 'Bash', input: { command: 'git push --force origin main' } }
let matchers = []
let initialized = false
let turn = 0
let waiting = new Map()
let answers = []
const sessionId =
  process.argv
    .find((arg) => arg.startsWith('--session-id=') || arg.startsWith('--resume='))
    ?.split('=')[1] ?? 'fake-session'

function initialize(hooks) {
  if (!hooks || (initialized && old)) {
    return {}
  }
  matchers = hooks.PreToolUse ?? []
  return old ? {} : { hooks_applied: true }
}

function finishTurn() {
  const denied = answers.find((answer) => answer?.hookSpecificOutput?.permissionDecision === 'deny')
  appendFileSync(answerFile, `${JSON.stringify(denied ?? answers[0] ?? null)}\n`)
  say({
    type: 'assistant',
    session_id: sessionId,
    uuid: `reply-${turn}`,
    parent_tool_use_id: null,
    message: {
      id: `reply-${turn}`,
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
    uuid: `result-${turn}`,
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
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'control_request') {
    const subtype = frame.request.subtype
    const applied = subtype === 'initialize' ? initialize(frame.request.hooks) : {}
    say({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: frame.request_id,
        response:
          subtype === 'get_settings'
            ? { model: 'claude-sonnet-5', permissionMode: 'default' }
            : { commands: [], models: [], capabilities: ['msg_lifecycle_v1'], ...applied }
      }
    })
    if (subtype === 'initialize') {
      initialized = true
      say({
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        uuid: 'init',
        model: 'claude-sonnet-5'
      })
    }
  } else if (frame.type === 'control_response' && waiting.has(frame.response?.request_id)) {
    waiting.delete(frame.response.request_id)
    answers.push(
      frame.response.subtype === 'error'
        ? { failed: frame.response.error }
        : frame.response.response
    )
    if (waiting.size === 0) {
      finishTurn()
    }
  } else if (frame.type === 'user') {
    // As --replay-user-messages: the send is settled by its echo.
    say({ ...frame, session_id: sessionId, isReplay: true })
    turn += 1
    answers = []
    const { tool, input } = toolCall()
    waiting = new Map(
      matchers
        .filter(({ matcher }) => !matcher || new RegExp(`^(?:${matcher})$`).test(tool))
        .flatMap((entry) => entry.hookCallbackIds)
        .map((id, index) => [`guard-${turn}-${index}`, id])
    )
    if (waiting.size === 0) {
      finishTurn()
      return
    }
    for (const [requestId, id] of waiting) {
      say({
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'hook_callback',
          callback_id: id,
          tool_use_id: `tool-${turn}`,
          input: {
            hook_event_name: 'PreToolUse',
            session_id: sessionId,
            transcript_path: '',
            cwd: process.cwd(),
            tool_name: tool,
            tool_input: input,
            tool_use_id: `tool-${turn}`
          }
        }
      })
    }
  }
})
