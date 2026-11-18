// Chat handoff (FORK.md, SLRM-2391): run a handoff on the host that runs the chat, through its
// fork.chatHandoff.start RPC, and say how it went in a toast. A chat in the middle of a turn is
// refused first; the toast offers to stop the turn and hand off.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { chatHandoffAgentLabel, type ChatHandoffAgent } from '../../../../shared/fork/chat-handoff'
import type { ChatHandoffResult } from '../../../../shared/fork/chat-handoff-wire'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/** Reading a long chat and starting the other agent can take a while on a busy host. */
const HANDOFF_TIMEOUT_MS = 2 * 60_000

export type ChatHandoffAsk = { sessionId: string; to: ChatHandoffAgent; stop?: boolean }

function startedText(result: Extract<ChatHandoffResult, { status: 'started' }>): string {
  const agent = chatHandoffAgentLabel(result.agent)
  const base =
    result.mode === 'continue'
      ? result.delivery === 'queued'
        ? translate(
            'fork.chatHandoff.continuedQueued',
            'Handed back to {{agent}}: "{{name}}" picks it up after its current turn.',
            { agent, name: result.name }
          )
        : translate('fork.chatHandoff.continued', 'Handed back to {{agent}}: "{{name}}".', {
            agent,
            name: result.name
          })
      : translate('fork.chatHandoff.started', 'Handed off to {{agent}}: "{{name}}".', {
          agent,
          name: result.name
        })
  const full =
    result.freshReason === 'context-full'
      ? ` ${translate(
          'fork.chatHandoff.contextFull',
          'Its earlier {{agent}} chat had no room left, so a new one started.',
          { agent }
        )}`
      : ''
  return `${base}${full}`
}

/** Hands the chat off and reports through toasts; returns the host's answer, or null on failure. */
export async function runChatHandoff(
  target: RuntimeClientTarget,
  ask: ChatHandoffAsk
): Promise<ChatHandoffResult | null> {
  let result: ChatHandoffResult
  try {
    result = await callRuntimeRpc<ChatHandoffResult>(
      target,
      'fork.chatHandoff.start',
      { sessionId: ask.sessionId, to: ask.to, focus: true, ...(ask.stop ? { stop: true } : {}) },
      { timeoutMs: HANDOFF_TIMEOUT_MS }
    )
  } catch (error) {
    toast.error(
      translate('fork.chatHandoff.failed', 'Could not hand off: {{message}}', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
    return null
  }
  if (result.status === 'started') {
    toast.success(startedText(result))
  } else if (result.status === 'refused' && result.reason === 'source-busy' && !ask.stop) {
    toast.info(
      translate(
        'fork.chatHandoff.busy',
        'This chat is in the middle of a turn. Stop it and hand off to {{agent}}?',
        { agent: chatHandoffAgentLabel(ask.to) }
      ),
      {
        duration: 20_000,
        action: {
          label: translate('fork.chatHandoff.stopAndHandOff', 'Stop and hand off'),
          onClick: () => {
            void runChatHandoff(target, { ...ask, stop: true })
          }
        }
      }
    )
  } else if (result.status === 'refused') {
    toast.error(
      translate('fork.chatHandoff.refused', 'Could not hand off: {{message}}', {
        message: result.message
      })
    )
  }
  return result
}
