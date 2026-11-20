import { describe, expect, it } from 'vitest'
import { proposalSoul, templateProposal, proposalSeed } from '../bots/bot-proposal'
import { botTemplate } from '../bots/bot-templates'
import { soulDescription } from '../bot-soul'
import {
  FORK_BOT_STARTING_RULES_MAX,
  forkBotStartingSoul,
  readForkBotStartingRules
} from './bot-starting-rules'

const READ_ONLY =
  '## Never\n\n- Change anything (comments, labels, pull requests, posts anywhere but here) until my owner says I can. I start by reading and reporting only.\n'

const RULES = '## How I work\n\n- Do the work, then report.\n\n## Never\n\n- Force-push.'

describe('bot starting rules', () => {
  const seed = { purpose: 'Watches the release branch.', does: 'Cuts release notes.' }

  it('keeps upstream exact text when unset or empty', () => {
    const upstream = proposalSoul('Milo', seed)
    expect(upstream.endsWith(READ_ONLY)).toBe(true)
    for (const settings of [
      undefined,
      {},
      { forkBotStartingRules: '' },
      { forkBotStartingRules: ' \n ' }
    ]) {
      expect(forkBotStartingSoul(upstream, settings)).toBe(upstream)
    }
  })

  it('puts the set rules in place of the read-only block', () => {
    const soul = forkBotStartingSoul(proposalSoul('Milo', seed), {
      forkBotStartingRules: `\r\n${RULES.replace(/\n/g, '\r\n')}\r\n\r\n`
    })
    expect(soul).toBe(
      `# Milo\n\nWatches the release branch.\n\n## How I work\n\n- Does: Cuts release notes.\n\n${RULES}\n`
    )
    expect(soul).not.toContain('reading and reporting only')
    expect(soulDescription(soul)).toBe('Watches the release branch.')
  })

  it('applies to a bot made from a template', () => {
    const template = botTemplate('support')!
    const soul = forkBotStartingSoul(
      proposalSoul(template.name, proposalSeed(templateProposal(template))),
      { forkBotStartingRules: RULES }
    )
    expect(soul).toContain(`- Started from the ${template.name} template.\n\n${RULES}\n`)
    expect(soul).not.toContain('reading and reporting only')
  })

  it('takes rules with $ patterns literally and caps their length', () => {
    const soul = forkBotStartingSoul(proposalSoul('Milo', seed), {
      forkBotStartingRules: "- Never run $& or $' in a shell."
    })
    expect(soul.endsWith("- Never run $& or $' in a shell.\n")).toBe(true)
    expect(
      readForkBotStartingRules({
        forkBotStartingRules: 'x'.repeat(FORK_BOT_STARTING_RULES_MAX + 9)
      })
    ).toHaveLength(FORK_BOT_STARTING_RULES_MAX)
    expect(readForkBotStartingRules({ forkBotStartingRules: 42 })).toBeNull()
  })

  it('leaves a soul without the upstream block alone', () => {
    expect(forkBotStartingSoul('# Milo\n\nMine.\n', { forkBotStartingRules: RULES })).toBe(
      '# Milo\n\nMine.\n'
    )
  })
})
