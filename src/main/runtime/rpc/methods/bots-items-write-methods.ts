// `bots.items.*` writes: only from a bot's own chat on this host, authored by that bot.
import {
  BotItemsAdd,
  BotItemsCancel,
  BotItemsComment,
  BotItemsDone,
  BotItemsLink,
  BotItemsSet
} from '../../../../shared/rpc-contract/bots-items-params'

import { botItemAskAdvice } from '../../../../shared/bots/bot-item-ask-advice'
import {
  BOT_ITEM_COMMAND_TIP,
  botItemCommentHoldsCommands
} from '../../../../shared/bots/bot-item-command-advice'
import { resolveItemSteps, withStepsMarkdown } from './bots-items-steps-input'
import { linksOutsideLinkedChains } from '../../../bots/bot-item-dispatch-facts'
import { defineMethod } from '../core'
import { addItem } from './bots-items-add'
import { admitBotItemFiles } from './bots-items-bot-files'
import { BotItemError } from '../../../bots/bot-item-error'
import { assertBotItemSetInput } from '../../../bots/bot-items-edits'
import { assertBotItemOwnerWrite } from '../../../bots/bot-items-tables'
import { commentAsMaker } from './bots-items-maker-comment'
import { parseItemLink, resolveItem, writeResult, writerOf } from './bots-items-write-support'

const ADD = defineMethod({
  name: 'bots.items.add',
  permission: 'workspace',
  params: BotItemsAdd,
  handler: addItem
})

const SET = defineMethod({
  name: 'bots.items.set',
  permission: 'workspace',
  params: BotItemsSet,
  handler: async (params, context) => {
    const writer = writerOf(params, context)
    const store = context.runtime.botItems.store()
    const item = await resolveItem(store, params.item)
    const { title, description, doneMeans, status, note, reason } = params
    let { comment, ask } = params
    // Fork BAD-747: steps for the owner; with the setting off they join the comment as a numbered list.
    const resolved = resolveItemSteps(context.runtime, params.steps)
    if (resolved.markdown) {
      if (ask) {
        ask = { ...ask, context: withStepsMarkdown(ask.context, resolved.markdown) }
      } else {
        comment = withStepsMarkdown(comment, resolved.markdown)
      }
    }
    if (params.files?.length && !comment?.trim() && !ask) {
      throw new BotItemError('invalid_argument', '--file goes with --comment. Nothing was posted.')
    }
    if (params.files?.length) {
      // What the write would refuse anyway is refused before any file is copied and claimed.
      assertBotItemSetInput({ title, description, doneMeans, status, note, reason, comment, ask })
      assertBotItemOwnerWrite(item, writer.actor, status)
    }
    // With an ask, the files go under its own context; its comment is the host's rendering of it.
    const words = ask ? (ask.context ?? '') : (comment ?? '')
    const attached = await admitBotItemFiles(context, item, words, params.files)
    if (ask && params.files?.length) {
      ask = { ...ask, ...(attached.text ? { context: attached.text } : {}) }
    } else if (!ask && comment !== undefined) {
      comment = attached.text
    }
    const images = attached.images.length > 0 ? attached.images : undefined
    const changes = {
      title,
      description,
      doneMeans,
      status,
      note,
      reason,
      comment,
      ask,
      images,
      steps: resolved.steps
    }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined)
    )
    const outcome = await store.set(item.uid, defined, writer.actor)
    const result = await writeResult(context.runtime, outcome, writer)
    // A tip back to the bot when its ask may be hard to read; the ask is already posted as written.
    const asking = status === 'needs_you' && result.eventId !== null
    const advice = asking ? botItemAskAdvice({ comment, ask }) : null
    // Fork BAD-747: commands in prose, outside steps and fenced blocks, get a tip naming --steps-file.
    const commandTip =
      asking &&
      !advice &&
      !params.steps &&
      botItemCommentHoldsCommands(ask?.context ?? comment ?? '')
        ? { codes: ['commands_in_prose'], tip: BOT_ITEM_COMMAND_TIP }
        : null
    const tip = advice ?? commandTip
    return tip ? { ...result, advice: tip } : result
  }
})

const COMMENT = defineMethod({
  name: 'bots.items.comment',
  permission: 'workspace',
  params: BotItemsComment,
  handler: async (params, context) => {
    const writer = writerOf(params, context)
    const store = context.runtime.botItems.store()
    const item = await resolveItem(store, params.item)
    if (params.files?.length && ![item.ownerBotId, item.madeBy?.botId].includes(writer.bot.id)) {
      assertBotItemOwnerWrite(item, writer.actor)
    }
    const { text, images } = await admitBotItemFiles(context, item, params.text, params.files)
    const outcome =
      item.ownerBotId !== writer.bot.id && item.madeBy?.botId === writer.bot.id
        ? await commentAsMaker(context, writer, item, text, images)
        : await store.comment(item.uid, text, writer.actor, images)
    return writeResult(context.runtime, outcome, writer)
  }
})

const DONE = defineMethod({
  name: 'bots.items.done',
  permission: 'workspace',
  params: BotItemsDone,
  handler: async (params, context) => {
    const writer = writerOf(params, context)
    const store = context.runtime.botItems.store()
    const item = await resolveItem(store, params.item)
    const outcome = await store.close(item.uid, 'done', params.note, writer.actor)
    return writeResult(context.runtime, outcome, writer)
  }
})

const CANCEL = defineMethod({
  name: 'bots.items.cancel',
  permission: 'workspace',
  params: BotItemsCancel,
  handler: async (params, context) => {
    const writer = writerOf(params, context)
    const store = context.runtime.botItems.store()
    const item = await resolveItem(store, params.item)
    const outcome = await store.close(item.uid, 'canceled', params.reason, writer.actor)
    return writeResult(context.runtime, outcome, writer)
  }
})

const LINK = defineMethod({
  name: 'bots.items.link',
  permission: 'workspace',
  params: BotItemsLink,
  handler: async (params, context) => {
    const writer = writerOf(params, context)
    const store = context.runtime.botItems.store()
    const item = await resolveItem(store, params.item)
    // A step of a follow-up chain the item already links is that worker again: no second link.
    const links = linksOutsideLinkedChains(
      context.runtime.getOrchestrationDb(),
      await store.links(item.uid),
      params.refs.map(parseItemLink)
    )
    const outcome = await store.link(item.uid, links, writer.actor)
    return writeResult(context.runtime, outcome, writer)
  }
})

export const BOT_ITEMS_WRITE_METHODS = [ADD, SET, COMMENT, DONE, CANCEL, LINK]
