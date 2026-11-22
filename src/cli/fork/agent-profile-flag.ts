// FORK.md "Agent profiles": `--profile <name>` on the commands that start agents. One hook in
// `dispatch` runs this before the handler. The host resolves the profile (its own settings, its
// own permission policy), then the result is written into the flags the handler already reads,
// so an explicit --agent, --model, --effort or --mcp-profile still wins.
import type { HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { RuntimeClientError } from '../runtime/connection/types'
import { isForkAgentProfileName } from '../../shared/fork/agent-profiles/agent-profiles-types'
import type { ForkAgentProfileResolveResult } from '../../shared/fork/agent-profiles/agent-profiles-wire'
import { FORK_AGENT_PROFILE_FLAG } from './agent-profile-specs'

type Target = {
  /** The flag naming the agent. */
  agent: string
  /** The flag holding the text the preamble goes in front of. */
  text: string
  createsWorktree: boolean
  /** A launch that names a bot gets its agent from the bot, so a profile does not apply. */
  skipWith?: string
}

const TARGETS: Readonly<Record<string, Target>> = {
  'agent launch': { agent: 'agent', text: 'prompt', createsWorktree: false },
  'worktree create': { agent: 'agent', text: 'prompt', createsWorktree: true },
  'orchestration worker-start': {
    agent: 'agent',
    text: 'spec',
    createsWorktree: false
  },
  'automations create': {
    agent: 'provider',
    text: 'prompt',
    createsWorktree: false,
    skipWith: 'bot'
  }
}

export const FORK_AGENT_PROFILE_COMMANDS: readonly string[] = Object.keys(TARGETS)

function present(flags: Map<string, string | boolean>, name: string): string | undefined {
  return getOptionalStringFlag(flags, name)?.trim() || undefined
}

export async function applyForkAgentProfile(key: string, ctx: HandlerContext): Promise<void> {
  const target = TARGETS[key]
  const { flags } = ctx
  if (!target || !flags.has(FORK_AGENT_PROFILE_FLAG)) {
    return
  }
  const name = present(flags, FORK_AGENT_PROFILE_FLAG)
  if (!name || !isForkAgentProfileName(name)) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--profile takes a profile name (letters, digits, dot, dash or underscore). See `orca profiles list`.'
    )
  }
  if (target.skipWith && flags.has(target.skipWith)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--profile cannot be used with --${target.skipWith}: that run takes its agent from the ${target.skipWith}.`
    )
  }
  const response = await ctx.client
    .call<ForkAgentProfileResolveResult>('fork.agentProfiles.resolve', {
      name,
      ...(present(flags, target.agent) ? { agent: present(flags, target.agent) } : {}),
      ...(present(flags, 'model') ? { model: present(flags, 'model') } : {}),
      ...(present(flags, 'effort') ? { effort: present(flags, 'effort') } : {}),
      ...(present(flags, 'mcp-profile') ? { mcpProfile: present(flags, 'mcp-profile') } : {}),
      createsWorktree: target.createsWorktree
    })
    .catch((error: unknown) => {
      if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'incompatible_runtime',
          'This Orca host has no agent profiles. Update Orca on the execution host and try again.'
        )
      }
      throw error
    })
  const { resolved } = response.result
  flags.set(target.agent, resolved.agent)
  if (resolved.model && !flags.has('model')) {
    flags.set('model', resolved.model)
  }
  if (resolved.effort && !flags.has('effort')) {
    flags.set('effort', resolved.effort)
  }
  if (resolved.mcpProfile && !flags.has('mcp-profile')) {
    flags.set('mcp-profile', resolved.mcpProfile)
  }
  if (resolved.preamble) {
    const existing = await readTextOrFileFlag(flags, ctx.cwd, target.text, false)
    if (existing !== undefined) {
      flags.delete(`${target.text}-file`)
      flags.set(target.text, `${resolved.preamble}\n\n${existing}`)
    }
  }
  const lines = [
    `profile: ${resolved.name}`,
    ...resolved.notes.map((note) => `profile note: ${note}`)
  ]
  // Stderr keeps --json output on stdout parseable.
  process.stderr.write(`${lines.join('\n')}\n`)
}
