// SLRM-2428 (FORK.md "Quick task"): `orca quick-task`, through quickTask.submit.
import type { CommandHandler } from '../dispatch/dispatch'
import { getRepeatedStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import {
  QUICK_TASK_SUBMIT_METHOD,
  QUICK_TASK_TEXT_MAX,
  type QuickTaskSubmitResult
} from '../../shared/fork/quick-task-contract'

/** The words after `quick-task`, joined as typed. */
export function readQuickTaskText(words: string[]): string {
  const text = words.join(' ').trim()
  if (!text) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Say what the task is: orca quick-task <text>.'
    )
  }
  if (text.length > QUICK_TASK_TEXT_MAX) {
    throw new RuntimeClientError(
      'invalid_argument',
      `A quick task is at most ${QUICK_TASK_TEXT_MAX} characters.`
    )
  }
  return text
}

export function formatQuickTaskResult(result: QuickTaskSubmitResult): string {
  return [`Sent to ${result.botName}.`, result.note, result.chatId ? `Chat: ${result.chatId}` : '']
    .filter(Boolean)
    .join('\n')
}

export const FORK_QUICK_TASK_HANDLERS: Record<string, CommandHandler> = {
  'quick-task': async (ctx) => {
    // An agent's chat hands work on itself; a quick task speaks for the owner.
    if (readInjectedAgentSessionId()) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Run orca quick-task yourself, not from an agent. Agents hand work to a bot with orca orchestration send --to bot:<name> --type handoff.'
      )
    }
    const text = readQuickTaskText(getRepeatedStringFlag(ctx.flags, 'text'))
    const result = await ctx.client
      .call<QuickTaskSubmitResult>(QUICK_TASK_SUBMIT_METHOD, { text, source: 'cli' })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no quick task. It needs a Blackfish build with SLRM-2428.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatQuickTaskResult)
  }
}
