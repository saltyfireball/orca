import { beforeEach, describe, expect, it, vi } from 'vitest'

const commentOnBotItem = vi.fn()
const answerDecisionInboxChat = vi.fn()
const refreshForkBotAsks = vi.fn()
const toast = { success: vi.fn(), error: vi.fn() }
const capability = vi.fn()

vi.mock('sonner', () => ({ toast }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/bot-hosts', () => ({
  botRefKey: (b: { hostId: string; id: string }) => `${b.hostId}:${b.id}`,
  botTarget: (b: { hostId: string }) => ({ hostId: b.hostId })
}))
vi.mock('@/runtime/rpc/targets/runtime-client-target', () => ({
  runtimeTargetEnvironmentId: (target: { hostId: string }) =>
    target.hostId === 'local' ? null : target.hostId
}))
vi.mock('@/runtime/rpc/compatibility/runtime-compatibility-cache', () => ({
  readCachedRuntimeEnvironmentCapability: (...args: unknown[]) => capability(...args)
}))
vi.mock('@/components/bots/items/use-bot-items', () => ({
  commentOnBotItem: (...args: unknown[]) => commentOnBotItem(...args)
}))
vi.mock('@/components/bots/bot-presentation', () => ({
  botErrorMessage: (error: unknown) => `failed: ${String(error)}`
}))
vi.mock('../bot-asks/bot-asks-store', () => ({
  refreshForkBotAsks: () => refreshForkBotAsks()
}))
vi.mock('../decision-inbox/decision-inbox-actions', () => ({
  answerDecisionInboxChat: (...args: unknown[]) => answerDecisionInboxChat(...args)
}))

const { needsYouAnswerPlan, needsYouTakesAnswer, sendNeedsYouAnswer } =
  await import('./needs-you-answer')
const { needsYouEntries } = await import('./needs-you-view')
const { NOW, boardAsk, bot, botAsk, card, chat } = await import('./needs-you-test-kit')

function entryOf(parts: Partial<Parameters<typeof needsYouEntries>[0]>) {
  const [entry] = needsYouEntries({
    botAsks: [],
    chats: [],
    chatClockOffset: 0,
    board: [],
    boardClockOffset: 0,
    agents: [],
    ...parts
  })
  if (!entry) {
    throw new Error('no entry')
  }
  return entry
}

const REPLIES = [
  { label: 'Yes', recommended: true },
  { label: 'No', recommended: false }
]

function oneQuestion(extra: Parameters<typeof botAsk>[3] = {}) {
  return entryOf({
    botAsks: [
      botAsk(bot('a'), 1, NOW, {
        question: {
          eventId: 'e9',
          text: 'Go?',
          decisions: [{ question: 'Go?', replies: REPLIES }]
        },
        ...extra
      })
    ]
  })
}

beforeEach(() => {
  commentOnBotItem.mockReset()
  commentOnBotItem.mockResolvedValue({})
  answerDecisionInboxChat.mockReset()
  refreshForkBotAsks.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  capability.mockReset()
})

describe('needsYouAnswerPlan', () => {
  it('offers the options and a text box on a one-question ask', () => {
    expect(needsYouAnswerPlan(oneQuestion(), true)).toEqual({
      kind: 'bot',
      questionId: 'e9',
      options: REPLIES
    })
  })

  it('offers only a text box to an ask with no options, and to a waiting chat', () => {
    const open = entryOf({ botAsks: [botAsk(bot('a'), 2, NOW)] })
    expect(needsYouAnswerPlan(open, true)).toEqual({ kind: 'bot', questionId: 'e2', options: [] })
    expect(needsYouAnswerPlan(entryOf({ chats: [chat('c', NOW)] }), true)).toEqual({ kind: 'chat' })
  })

  it('opens the item for an ask with several questions, a pick-several one or owner steps', () => {
    const several = oneQuestion({
      question: {
        eventId: 'e9',
        text: 'Go?',
        decisions: [
          { question: 'One?', replies: REPLIES },
          { question: 'Two?', replies: REPLIES }
        ]
      }
    })
    const multi = oneQuestion({
      question: {
        eventId: 'e9',
        text: 'Go?',
        decisions: [{ question: 'Which?', replies: REPLIES, multi: true }]
      }
    })
    const steps = oneQuestion({
      steps: { eventId: 'e5', steps: [{ text: 'Run it', state: 'open' }] as never }
    })
    for (const entry of [several, multi, steps]) {
      expect(needsYouAnswerPlan(entry, true)).toEqual({ kind: 'open' })
    }
  })

  it('never offers an approval, a board ask, a bare question-less item or a pull request row', () => {
    expect(needsYouAnswerPlan(entryOf({ agents: [card('p', NOW)] }), true)).toEqual({
      kind: 'open'
    })
    expect(needsYouAnswerPlan(entryOf({ board: [boardAsk('b', NOW)] }), true)).toEqual({
      kind: 'open'
    })
    expect(
      needsYouAnswerPlan(entryOf({ botAsks: [botAsk(bot('a'), 3, NOW, { question: null })] }), true)
    ).toEqual({ kind: 'open' })
    expect(
      needsYouAnswerPlan(entryOf({ chats: [chat('c', NOW, { source: 'babysit' })] }), true)
    ).toEqual({ kind: 'open' })
  })

  it('offers nothing with quick answers off', () => {
    expect(needsYouTakesAnswer(oneQuestion(), false)).toBe(false)
    expect(needsYouTakesAnswer(oneQuestion(), true)).toBe(true)
  })
})

describe('sendNeedsYouAnswer', () => {
  it('posts an option as the owner comment of the ask, naming the question it answers', async () => {
    const entry = oneQuestion()
    const plan = needsYouAnswerPlan(entry, true)
    // This computer's own host always takes the question id.
    expect(await sendNeedsYouAnswer(entry, plan, ' Yes ')).toBe(true)
    expect(commentOnBotItem).toHaveBeenCalledWith(
      entry.target.kind === 'bot-ask' ? entry.target.ask.bot : null,
      'uid-1',
      'Yes',
      [],
      undefined,
      'e9'
    )
    expect(refreshForkBotAsks).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })

  it('leaves the question id off for a paired server that does not take it', async () => {
    const entry = entryOf({
      botAsks: [
        botAsk(bot('a', 'ssh:paired-1'), 1, NOW, {
          question: {
            eventId: 'e9',
            text: 'Go?',
            decisions: [{ question: 'Go?', replies: REPLIES }]
          }
        })
      ]
    })
    capability.mockReturnValue(false)
    await sendNeedsYouAnswer(entry, needsYouAnswerPlan(entry, true), 'No')
    expect(commentOnBotItem.mock.calls[0]?.[5]).toBeUndefined()
    capability.mockReturnValue(true)
    await sendNeedsYouAnswer(entry, needsYouAnswerPlan(entry, true), 'No')
    expect(commentOnBotItem.mock.calls[1]?.[5]).toBe('e9')
  })

  it('reports a refusal and leaves the ask listed', async () => {
    commentOnBotItem.mockRejectedValue('the agent asked a new question')
    const entry = oneQuestion()
    expect(await sendNeedsYouAnswer(entry, needsYouAnswerPlan(entry, true), 'Yes')).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('answers a chat through the Decision inbox, and sends nothing empty or to an open entry', async () => {
    const entry = entryOf({ chats: [chat('c', NOW)] })
    answerDecisionInboxChat.mockResolvedValue(true)
    expect(await sendNeedsYouAnswer(entry, { kind: 'chat' }, 'go on')).toBe(true)
    expect(answerDecisionInboxChat).toHaveBeenCalledWith(
      entry.target.kind === 'chat' ? entry.target.item : null,
      'go on'
    )
    expect(await sendNeedsYouAnswer(entry, { kind: 'chat' }, '   ')).toBe(false)
    expect(await sendNeedsYouAnswer(entry, { kind: 'open' }, 'x')).toBe(false)
    expect(answerDecisionInboxChat).toHaveBeenCalledTimes(1)
    expect(commentOnBotItem).not.toHaveBeenCalled()
  })
})
