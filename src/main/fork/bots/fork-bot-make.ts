// The fork's two hooks in the bot controller's makeBot, kept out of upstream's file so it stays under its
// line limit (BAD-834, FORK.md "Bot starting rules" and "Launch defaults").
import { proposalSoul } from '../../../shared/bots/bot-proposal'
import type { BotCreateParams } from '../../../shared/rpc-contract/bots-params'
import { forkBotStartingSoul } from '../../../shared/fork/bot-starting-rules'
import { withForkBotDefaultLaunch } from '../../../shared/fork/launch-defaults/launch-defaults-bot'

/** A new bot's create params with the "bot" launch default filled in when it brings no launch. */
export function forkNewBotInput(input: BotCreateParams, name: string, settings: unknown) {
  return withForkBotDefaultLaunch({ ...input, name }, settings)
}

/** The SOUL.md a seeded bot starts with, with the owner's starting rules in place of the read-only block. */
export function forkSeedSoul(name: string, seed: string | undefined, settings: unknown) {
  return seed ? forkBotStartingSoul(proposalSoul(name, seed), settings) : undefined
}
