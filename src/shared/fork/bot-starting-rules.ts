// Bot starting rules (SLRM-2459, FORK.md): the rules a new bot's SOUL.md starts with, in place of
// upstream's read-only "## Never" block. Unset or empty keeps upstream's exact text. Applied by
// the one hook in the bot controller, so it covers every way a bot is made from a seed: the New bot
// dialog, `bot create --offer` cards, templates and the quick task router.
import { READ_ONLY_START } from '../bots/bot-proposal'

export type ForkBotStartingRulesSettings = {
  /** Fork bot starting rules (SLRM-2459): Markdown a new bot's SOUL.md gets in place of the default "## Never" block that keeps it read-only until its owner says otherwise; unset or empty keeps that default. Set it in the Settings screen. */
  forkBotStartingRules?: string
}

/** Long enough for a few sections of rules; SOUL.md is read on every turn. */
export const FORK_BOT_STARTING_RULES_MAX = 4000

/** Upstream's block, as `proposalSoul` writes it. */
const UPSTREAM_BLOCK = `## Never\n\n${READ_ONLY_START}`

/** The rules text to use, or null for upstream's own. */
export function readForkBotStartingRules(settings: unknown): string | null {
  const value = (settings ?? {}) as ForkBotStartingRulesSettings
  const rules =
    typeof value.forkBotStartingRules === 'string'
      ? value.forkBotStartingRules.replace(/\r\n/g, '\n').trim()
      : ''
  return rules ? rules.slice(0, FORK_BOT_STARTING_RULES_MAX).trimEnd() : null
}

/** A new bot's SOUL.md with the owner's starting rules in place of upstream's read-only block.
 *  A soul without that block (upstream reworded it) is left as it is. */
export function forkBotStartingSoul(soul: string, settings: unknown): string {
  const rules = readForkBotStartingRules(settings)
  if (!rules) {
    return soul
  }
  const at = soul.lastIndexOf(UPSTREAM_BLOCK)
  return at === -1 ? soul : `${soul.slice(0, at)}${rules}${soul.slice(at + UPSTREAM_BLOCK.length)}`
}
