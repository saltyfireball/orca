// The owner's comment event and the owner's marks on an item's steps (BAD-747), the writes the rest of
// the owner's panel builds on.
import {
  botItemEventId,
  isOpenBotItemStatus,
  type BotItemCommentImage,
  type BotItemCommentSkill
} from '../../shared/bots/bot-items'
import { botItemQuestionShape } from '../../shared/bots/bot-item-ask'
import {
  BOT_ITEM_STEP_LIMITS,
  botItemDoneReplyLabel,
  botItemStepsFromEvents,
  type BotItemStepState
} from '../../shared/bots/bot-item-steps'
import { BotItemError } from './bot-item-error'
import { BotItemsWrites } from './bot-items-writes'
import type { BotItemOwnerActor } from './bot-items-input'
import { eventRecordOf } from './bot-items-rows'
import type { BotItemEventRecord, BotItemRecord } from './bot-items-schema'

/** The owner marks one step of the item's current set: ticks it, unticks it, or says it did not work. */
export type BotItemOwnerStepInput = {
  /** The steps event the owner's view showed: a newer set refuses the mark. */
  set: number
  index: number
  state: BotItemStepState
  /** With `failed`: what went wrong, as pasted. */
  error?: string
  /** Answer the ask as done once the last step is ticked, when one option plainly says so. */
  autoAnswer?: boolean
}

export type BotItemOwnerStepOutcome = {
  uid: string
  eventId: number | null
  /** This mark ticked the last step. */
  completed: boolean
  /** The ask was answered as done with it. */
  answered: boolean
}

export class BotItemsOwnerWrites extends BotItemsWrites {
  /** Fork BAD-747. A tick is recorded and mails nobody; the tick of the last step mails the chat once for
   *  all of them (and answers the ask as done when `autoAnswer` and one option plainly says so); a step
   *  that did not work mails at once with its number and the pasted error, and hands the item back. */
  ownerStep(
    uid: string,
    input: BotItemOwnerStepInput,
    actor: BotItemOwnerActor,
    now = Date.now()
  ): BotItemOwnerStepOutcome {
    if (input.error !== undefined && input.error.length > BOT_ITEM_STEP_LIMITS.error) {
      throw new BotItemError(
        'invalid_argument',
        `The error is over ${BOT_ITEM_STEP_LIMITS.error} characters. Paste the last lines.`
      )
    }
    return this.transaction(() => {
      const item = this.requireItem(uid)
      if (!isOpenBotItemStatus(item.status)) {
        throw new BotItemError('item_closed', `Item ${item.number} is closed.`)
      }
      const current = this.openSteps([item])[uid]
      if (!current || current.set.id !== input.set) {
        throw new BotItemError(
          'item_changed',
          `Item ${item.number} has new steps. Read them, then mark them.`
        )
      }
      const setId = botItemEventId(current.set.id)
      const view = botItemStepsFromEvents(current.set, current.marks, setId)
      const step = view?.steps[input.index]
      if (!view || !step) {
        throw new BotItemError('invalid_argument', `The item has no step ${input.index + 1}.`)
      }
      const error = input.error?.trim()
      if (input.state === 'failed' && !error) {
        throw new BotItemError('invalid_argument', 'Paste what went wrong with this step.')
      }
      if (step.state === input.state && input.state !== 'failed') {
        return { uid, eventId: null, completed: false, answered: false }
      }
      const failed = input.state === 'failed'
      const mark = {
        set: setId,
        index: input.index,
        state: input.state,
        ...(failed ? { title: step.title, error } : {})
      }
      let eventId = this.appendEvent(uid, 'step', actor, mark, failed, now)
      if (failed) {
        this.endSnooze(uid, actor, now)
        if (item.status === 'needs_you') {
          this.writeStatus(uid, 'working', null, actor, now)
          const moved = { from: item.status, to: 'working', cause: 'step' }
          eventId = this.appendEvent(uid, 'status', actor, moved, true, now)
        }
        return { uid, eventId, completed: false, answered: false }
      }
      const everyDone =
        input.state === 'done' &&
        view.steps.every((s) => s.index === input.index || s.state === 'done')
      if (!everyDone || this.stepsAlreadyFinished(uid, setId)) {
        return { uid, eventId, completed: false, answered: false }
      }
      const titles = view.steps.map((s) => s.title)
      eventId = this.appendEvent(uid, 'steps_done', actor, { set: setId, titles }, true, now)
      const answered = input.autoAnswer === true && this.answerAsDone(item, actor, now)
      return { uid, eventId, completed: true, answered }
    })
  }

  private stepsAlreadyFinished(uid: string, setId: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM item_events WHERE item_uid = ? AND kind = 'steps_done'
             AND json_extract(data, '$.set') = ? LIMIT 1`
        )
        .get(uid, setId) !== undefined
    )
  }

  /** The ask's one plain "done" option, sent as the owner's quick reply; false when the item is not
   *  waiting on a question of the bot's, or no option plainly says done. */
  private answerAsDone(item: BotItemRecord, actor: BotItemOwnerActor, now: number): boolean {
    if (item.status !== 'needs_you' || item.questionEvent === null) {
      return false
    }
    const row = this.db.prepare('SELECT * FROM item_events WHERE id = ?').get(item.questionEvent)
    const question = row ? eventRecordOf(row) : null
    if (!question || question.actor.kind !== 'bot') {
      return false
    }
    const label = botItemDoneReplyLabel(botItemQuestionShape(question.data).decisions)
    if (label === null) {
      return false
    }
    this.writeOwnerComment(
      item,
      label,
      actor,
      now,
      [],
      undefined,
      botItemEventId(item.questionEvent)
    )
    this.writeStatus(item.uid, 'working', null, actor, now)
    const moved = { from: item.status, to: 'working', cause: 'answer' }
    this.appendEvent(item.uid, 'status', actor, moved, true, now)
    return true
  }

  /** The bot's question event; the owner's own Needs you note is no question to answer. */
  protected botQuestion(eventId: number): BotItemEventRecord | null {
    const row = this.db.prepare('SELECT * FROM item_events WHERE id = ?').get(eventId)
    const event = row === undefined ? null : eventRecordOf(row)
    return event?.actor.kind === 'bot' ? event : null
  }

  protected writeOwnerComment(
    item: BotItemRecord,
    commentText: string,
    actor: BotItemOwnerActor,
    now: number,
    images: readonly BotItemCommentImage[] = [],
    requestId?: string,
    answers?: string,
    plain = false,
    skills: readonly BotItemCommentSkill[] = [],
    askedInConversation?: string
  ): number {
    const data = {
      text: commentText,
      ...(images.length > 0 ? { images } : {}),
      ...(requestId === undefined ? {} : { requestId }),
      ...(answers === undefined ? {} : { answers }),
      ...(plain ? { plain: true } : {}),
      ...(skills.length > 0 ? { skills } : {}),
      ...(askedInConversation === undefined ? {} : { askedInConversation })
    }
    return this.appendEvent(item.uid, 'commented', actor, data, true, now)
  }
}
