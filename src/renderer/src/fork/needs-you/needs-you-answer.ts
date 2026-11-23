// Needs you (FORK.md "Needs you list", BAD-759): quick answers. Which entries take one in the list,
// and sending it through the same owner path as the item panel (`bots.items.owner.comment`, which
// the item's host checks against the owner) or, for a chat, as the Decision inbox does. A tool
// permission approval is never answered here: it jumps to its own prompt. Nothing here runs on a
// key: the list calls `sendNeedsYouAnswer` only from a press on an option or on Send.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { botTarget } from '@/lib/bot-hosts'
import { readCachedRuntimeEnvironmentCapability } from '@/runtime/rpc/compatibility/runtime-compatibility-cache'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import { commentOnBotItem } from '@/components/bots/items/use-bot-items'
import { botErrorMessage } from '@/components/bots/bot-presentation'
import { BOTS_ITEM_COMMENT_QUESTION_ID_RUNTIME_CAPABILITY } from '../../../../shared/bot-runtime-capabilities'
import type { BotItemQuickReply } from '../../../../shared/bots/bot-item-ask'
import { refreshForkBotAsks } from '../bot-asks/bot-asks-store'
import { answerDecisionInboxChat } from '../decision-inbox/decision-inbox-actions'
import type { NeedsYouEntry } from './needs-you-view'

export type NeedsYouAnswerPlan =
  /** Buttons for each option, and a text box. `questionId`: the ask the answer names. */
  | { kind: 'bot'; questionId: string; options: readonly BotItemQuickReply[] }
  /** A text box only: a chat waiting on a reply. */
  | { kind: 'chat' }
  /** No answer here: Enter opens the item or the prompt (several questions or owner steps, approvals, board asks). */
  | { kind: 'open' }

/** What the list offers on an entry. `quickAnswers` is the setting. */
export function needsYouAnswerPlan(
  entry: NeedsYouEntry,
  quickAnswers: boolean
): NeedsYouAnswerPlan {
  if (!quickAnswers) {
    return { kind: 'open' }
  }
  const target = entry.target
  if (target.kind === 'chat') {
    // A pull request or a failed check is no question to type an answer to.
    return target.item.source ? { kind: 'open' } : { kind: 'chat' }
  }
  if (target.kind !== 'bot-ask') {
    return { kind: 'open' }
  }
  const { question, item } = target.ask
  if (!question) {
    return { kind: 'open' }
  }
  const decisions = question.decisions ?? []
  // Several questions, a pick-several question, or steps the owner is to do: the item takes them.
  if (decisions.length > 1 || decisions[0]?.multi || (item.steps?.steps.length ?? 0) > 0) {
    return { kind: 'open' }
  }
  return { kind: 'bot', questionId: question.eventId, options: decisions[0]?.replies ?? [] }
}

/** True for an entry with something to answer in the list. */
export function needsYouTakesAnswer(entry: NeedsYouEntry, quickAnswers: boolean): boolean {
  return needsYouAnswerPlan(entry, quickAnswers).kind !== 'open'
}

/** An unknown answer is no: an older host refuses the field. This app's own host always takes it. */
function takesQuestionId(entry: NeedsYouEntry): boolean {
  if (entry.target.kind !== 'bot-ask') {
    return false
  }
  const environmentId = runtimeTargetEnvironmentId(botTarget(entry.target.ask.bot))
  return (
    environmentId === null ||
    readCachedRuntimeEnvironmentCapability(
      environmentId,
      BOTS_ITEM_COMMENT_QUESTION_ID_RUNTIME_CAPABILITY
    ) === true
  )
}

/**
 * Sends the owner's answer to the entry. True only when it went through; a refusal (the agent asked
 * a new question meanwhile, a host that is away) is a toast and leaves the entry listed.
 */
export async function sendNeedsYouAnswer(
  entry: NeedsYouEntry,
  plan: NeedsYouAnswerPlan,
  text: string
): Promise<boolean> {
  const words = text.trim()
  if (!words) {
    return false
  }
  const target = entry.target
  if (plan.kind === 'bot' && target.kind === 'bot-ask') {
    try {
      await commentOnBotItem(
        target.ask.bot,
        target.ask.item.uid,
        words,
        [],
        undefined,
        takesQuestionId(entry) ? plan.questionId : undefined
      )
      toast.success(
        translate('fork.needsYou.toast.sent', 'Answer sent to {{name}}.', { name: entry.name })
      )
      return true
    } catch (failure) {
      toast.error(botErrorMessage(failure))
      return false
    } finally {
      refreshForkBotAsks()
    }
  }
  if (plan.kind === 'chat' && target.kind === 'chat') {
    return answerDecisionInboxChat(target.item, words)
  }
  return false
}
