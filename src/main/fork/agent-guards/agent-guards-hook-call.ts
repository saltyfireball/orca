// Agent guards (FORK.md, SLRM-2385): a finished tool call of a terminal agent, read from the hook
// post the agent sent Orca (Claude Code's PostToolUse and PostToolUseFailure, Codex's and other
// agents' after-tool events). The tool, its input and its output come from the reader plugins
// already use; this adds whether the call failed and its error. Pure apart from the clock.
import type { AgentHookSource } from '../../../shared/agent-hook-listener/transport/agent-hook-relay'
import { normalizeHookEventName } from '../../../shared/agent-hook-listener/provider-event-names'
import { parseAgentHookJson } from '../../../shared/agent-hook-listener/request-body'
import type { AgentGuardToolCall } from '../../../shared/fork/agent-guards'
import {
  readAgentToolCall,
  type AgentToolCallOwner
} from '../../agent-hooks/tool-events/agent-tool-call-reader'

const FAILURE_EVENTS = new Set(['post_tool_use_failure'])
const MAX_ERROR_SCAN = 4000

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return ''
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

const nonZero = (value: unknown): boolean =>
  (typeof value === 'number' && Number.isFinite(value) && value !== 0) ||
  (typeof value === 'string' && /^-?[1-9]\d*$/.test(value.trim()))

/** Codex prints `Exit code: N` at the head of a shell call's output. */
const EXIT_LINE = /(^|\n)\s*(process )?exit(ed with)? code:?\s*(-?[1-9]\d*)/i

/** Whether the output says the call failed, and the text to compare. */
export function agentGuardOutputFailure(output: unknown): { failed: boolean; error: string } {
  const out = record(output)
  if (out) {
    const flagged =
      out.is_error === true ||
      out.isError === true ||
      out.success === false ||
      nonZero(out.exit_code) ||
      nonZero(out.exitCode) ||
      nonZero(out.returncode)
    if (flagged) {
      return {
        failed: true,
        error: text(out.stderr ?? out.error ?? out.output ?? out.content ?? out.stdout ?? output)
      }
    }
    return { failed: false, error: '' }
  }
  const raw = text(output).slice(0, MAX_ERROR_SCAN)
  return EXIT_LINE.test(raw.slice(0, 400))
    ? { failed: true, error: raw }
    : { failed: false, error: '' }
}

export type AgentGuardHookCall = {
  paneKey: string
  worktreeId: string | null
  agent: string
  call: AgentGuardToolCall
  /** BAD-679: the transcript file the agent named in the post, for its spend. */
  transcriptPath: string | null
}

/** The finished call a hook post reports, or null for anything else (a before-tool event too). */
export function readAgentGuardHookCall(
  source: AgentHookSource,
  body: unknown,
  owner: AgentToolCallOwner,
  now: number
): AgentGuardHookCall | null {
  const call = readAgentToolCall(source, body, owner)
  if (!call || call.phase !== 'after' || !owner.paneKey) {
    return null
  }
  let hook: Record<string, unknown> | null = null
  try {
    const raw = record(body)?.payload
    hook = record(typeof raw === 'string' ? parseAgentHookJson(raw) : raw)
  } catch {
    hook = null
  }
  const event = normalizeHookEventName(owner.hookEventName)
  const failure = FAILURE_EVENTS.has(event)
    ? { failed: true, error: text(hook?.error ?? call.payload.output) }
    : agentGuardOutputFailure(call.payload.output)
  if (hook?.is_interrupt === true) {
    // The person stopped it: not a failing step.
    return null
  }
  return {
    paneKey: owner.paneKey,
    worktreeId: owner.worktreeId ?? null,
    agent: source,
    transcriptPath: typeof hook?.transcript_path === 'string' ? hook.transcript_path : null,
    call: {
      tool: call.payload.tool,
      input: call.payload.input,
      failed: failure.failed,
      error: failure.error.slice(0, MAX_ERROR_SCAN),
      at: now
    }
  }
}
