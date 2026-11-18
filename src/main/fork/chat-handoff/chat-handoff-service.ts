// Chat handoff (FORK.md, SLRM-2391): the rules. A handoff reads the source chat's history, picks
// what fits the budget and either starts a fresh chat of the other agent in the same workspace with
// it, or, when the work came from a chat of that agent and that chat's context has room, sends it
// only what is new. The source is never closed; its own resume at a usage limit is cancelled so two
// agents do not take up the same work. Ports keep it testable without a chat host.
import {
  chatHandoffAgentLabel,
  chatHandoffRoom,
  isChatHandoffAgent,
  type ChatHandoffAgent,
  type ChatHandoffSettings
} from '../../../shared/fork/chat-handoff'
import {
  buildChatHandoffMessage,
  chatHandoffName,
  selectChatHandoffHistory,
  type ChatHandoffSelection
} from '../../../shared/fork/chat-handoff-select'
import type {
  ChatHandoffRefusal,
  ChatHandoffResult,
  ChatHandoffStarted
} from '../../../shared/fork/chat-handoff-wire'
import type { ChatHandoffRead } from './chat-handoff-entries'
import { chatHandoffEntriesOf } from './chat-handoff-entries'
import type { ChatHandoffLinks } from './chat-handoff-links'

export type ChatHandoffChat = {
  sessionId: string
  agent: string
  workspaceId: string
  name: string | null
  /** Working, waiting on a prompt, or starting. */
  inTurn: boolean
  /** Stock usage-limit continue has a resume scheduled for it. */
  limitResumeScheduled: boolean
}

export type ChatHandoffContext = {
  windowTokens: number | null
  usedTokens: number | null
  /** What the chat holds by its own text, for when it never reported its usage. */
  estimatedTokens: number
}

export type ChatHandoffPorts = {
  settings: () => ChatHandoffSettings
  chat: (sessionId: string) => ChatHandoffChat | null
  rows: (sessionId: string, after?: number) => Promise<ChatHandoffRead>
  context: (sessionId: string) => Promise<ChatHandoffContext>
  stopTurn: (sessionId: string) => Promise<boolean>
  create: (input: {
    workspaceId: string
    agent: ChatHandoffAgent
    text: string
    name: string
    focus: boolean
  }) => Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>
  send: (sessionId: string, text: string) => Promise<'sent' | 'queued' | 'refused' | 'unknown'>
  cancelLimitResume: (sessionId: string) => Promise<boolean>
  links: ChatHandoffLinks
  now: () => number
}

export type ChatHandoffRequest = {
  sessionId: string
  to: ChatHandoffAgent
  request?: string
  fresh?: boolean
  stop?: boolean
  focus?: boolean
  dryRun?: boolean
}

type Plan = {
  mode: 'new' | 'continue'
  target: ChatHandoffChat | null
  selection: ChatHandoffSelection
  throughSeq: number
  freshReason?: 'context-full' | 'asked'
}

const refuse = (reason: ChatHandoffRefusal, message: string): ChatHandoffResult => ({
  status: 'refused',
  reason,
  message
})

export class ChatHandoffService {
  private readonly inFlight = new Set<string>()

  constructor(private readonly ports: ChatHandoffPorts) {}

  async start(input: ChatHandoffRequest): Promise<ChatHandoffResult> {
    const settings = this.ports.settings()
    if (!settings.enabled) {
      return refuse('disabled', 'Chat handoff is turned off in Settings > Blackfish > Chats.')
    }
    const source = this.ports.chat(input.sessionId)
    if (!source) {
      return refuse('not-found', `No chat with session id ${input.sessionId} on this host.`)
    }
    if (!isChatHandoffAgent(source.agent)) {
      return refuse('unsupported-agent', 'Only Claude and Codex chats can be handed off.')
    }
    if (source.agent === input.to) {
      return refuse('same-agent', `This chat already runs on ${chatHandoffAgentLabel(input.to)}.`)
    }
    if (this.inFlight.has(source.sessionId)) {
      return refuse('in-progress', 'A handoff of this chat is already under way.')
    }
    this.inFlight.add(source.sessionId)
    try {
      return await this.run(input, source, settings)
    } finally {
      this.inFlight.delete(source.sessionId)
    }
  }

  private async run(
    input: ChatHandoffRequest,
    source: ChatHandoffChat,
    settings: ChatHandoffSettings
  ): Promise<ChatHandoffResult> {
    let stoppedSource = false
    if (source.inTurn && !input.dryRun) {
      if (!input.stop || !(await this.ports.stopTurn(source.sessionId))) {
        return refuse(
          'source-busy',
          input.stop
            ? 'Its running turn could not be stopped.'
            : 'It is in the middle of a turn. Stop it first, or hand off with stop.'
        )
      }
      stoppedSource = true
    }
    const name = chatHandoffName(source.name, source.agent)
    const plan = await this.plan(input, source, settings)
    if (plan.selection.count === 0 && !input.request?.trim() && plan.mode === 'new') {
      return refuse('empty', 'The chat has no history to hand off yet.')
    }
    const message = buildChatHandoffMessage({
      mode: plan.mode,
      source: { id: source.sessionId, name, agent: source.agent },
      selection: plan.selection,
      ...(input.request ? { request: input.request } : {})
    })
    const started: ChatHandoffStarted = {
      status: input.dryRun ? 'planned' : 'started',
      mode: plan.mode,
      ...(plan.freshReason ? { freshReason: plan.freshReason } : {}),
      sessionId: plan.target?.sessionId ?? null,
      agent: input.to,
      name: plan.target?.name ?? `${name} (${chatHandoffAgentLabel(input.to)})`,
      entries: plan.selection.count,
      omittedOlder: plan.selection.omittedBefore !== null,
      historyTokens: plan.selection.tokens,
      budgetTokens: settings.budgetTokens,
      stoppedSource,
      cancelledLimitResume: false
    }
    if (input.dryRun) {
      return { ...started, message }
    }
    const delivered = await this.deliver(plan, source, started, message, input.focus === true)
    if (delivered.status === 'refused') {
      return delivered
    }
    await this.ports.links.add({
      from: source.sessionId,
      fromAgent: source.agent as ChatHandoffAgent,
      to: delivered.sessionId ?? '',
      toAgent: input.to,
      throughSeq: plan.throughSeq,
      at: this.ports.now()
    })
    const cancelled = source.limitResumeScheduled
      ? await this.ports.cancelLimitResume(source.sessionId).catch(() => false)
      : false
    return { ...delivered, cancelledLimitResume: cancelled }
  }

  private async deliver(
    plan: Plan,
    source: ChatHandoffChat,
    started: ChatHandoffStarted,
    message: string,
    focus: boolean
  ): Promise<ChatHandoffResult & { status: 'started' | 'refused' }> {
    if (plan.mode === 'continue' && plan.target) {
      const outcome = await this.ports.send(plan.target.sessionId, message)
      if (outcome === 'refused' || outcome === 'unknown') {
        return {
          status: 'refused',
          reason: 'send-failed',
          message:
            outcome === 'unknown'
              ? 'The message may have reached the other chat; it was not sent again.'
              : 'The other chat did not take the message.'
        }
      }
      return { ...started, status: 'started', delivery: outcome }
    }
    const created = await this.ports.create({
      workspaceId: source.workspaceId,
      agent: started.agent,
      text: message,
      name: started.name,
      focus
    })
    if (!created.ok) {
      return { status: 'refused', reason: 'create-failed', message: created.message }
    }
    return { ...started, status: 'started', sessionId: created.sessionId }
  }

  private async plan(
    input: ChatHandoffRequest,
    source: ChatHandoffChat,
    settings: ChatHandoffSettings
  ): Promise<Plan> {
    let freshReason: Plan['freshReason']
    const partner = settings.reuse ? this.ports.links.partner(source.sessionId, input.to) : null
    const target = partner ? this.ports.chat(partner.id) : null
    if (
      partner &&
      target &&
      target.agent === input.to &&
      target.workspaceId === source.workspaceId
    ) {
      if (input.fresh) {
        freshReason = 'asked'
      } else {
        const read = await this.ports.rows(source.sessionId, partner.seenThrough)
        const selection = this.select(read, source.sessionId, settings.budgetTokens, read.complete)
        const context = await this.ports.context(target.sessionId)
        const room = chatHandoffRoom({
          windowTokens: context.windowTokens,
          usedTokens: context.usedTokens,
          estimatedUsed: context.estimatedTokens
        })
        if (selection.tokens <= room) {
          return {
            mode: 'continue',
            target,
            selection,
            throughSeq: newestSeq(read, partner.seenThrough)
          }
        }
        freshReason = 'context-full'
      }
    }
    const read = await this.ports.rows(source.sessionId)
    return {
      mode: 'new',
      target: null,
      selection: this.select(read, source.sessionId, settings.budgetTokens, read.complete),
      throughSeq: newestSeq(read, 0),
      ...(freshReason ? { freshReason } : {})
    }
  }

  private select(
    read: ChatHandoffRead,
    sourceId: string,
    budget: number,
    complete: boolean
  ): ChatHandoffSelection {
    return selectChatHandoffHistory(chatHandoffEntriesOf(read.items, sourceId), budget, {
      sourceId,
      complete
    })
  }
}

function newestSeq(read: ChatHandoffRead, fallback: number): number {
  return read.items.at(-1)?.sequence ?? fallback
}
