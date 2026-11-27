// FORK.md "Custom ACP agents": a program the user names that speaks the Agent Client Protocol over
// stdio. Every one runs as the one chat agent `custom-acp`; the name picks the program per chat.
import { isTuiAgent } from '../../agent-launch/catalog/tui-agent-config'

export const CUSTOM_ACP_AGENT = 'custom-acp' as const

/** The create option that names which custom agent a new chat runs; the host moves it into the
 *  chat's pin and never keeps it as a session option. */
export const CUSTOM_ACP_AGENT_OPTION_ID = 'customAcpAgent'

export type ForkCustomAcpAgent = {
  /** What `--agent` and the new-chat menu take: lowercase letters, digits and dashes. */
  name: string
  /** The program: an absolute path, or a name looked up on PATH. */
  command: string
  args?: string[]
  /** Absolute folder the program starts in; absent, it starts in the chat's folder. */
  cwd?: string
  /** Names of the variables the program gets; their values stay in this host's private store. */
  env?: string[]
  /** The agent keeps its own persona: Orca never sends a bot's SOUL.md or MEMORY.md, only its
   *  rules, as context the agent may use. */
  ownsPrompt?: boolean
}

export type ForkCustomAcpAgentSettings = {
  /** Fork custom ACP agents: programs that speak ACP over stdio, run as chats and bots by name; unset is none. Saved by orca agent custom add|remove; env values are kept apart, in this host's private store. */
  forkCustomAcpAgents?: ForkCustomAcpAgent[]
}

export const CUSTOM_ACP_AGENT_LIMITS = {
  agents: 32,
  args: 64,
  argChars: 4096,
  commandChars: 4096,
  env: 64,
  envValueChars: 32_768
} as const

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
// Orca sets these for every agent it starts; a custom agent cannot replace them.
const RESERVED_ENV = /^(ORCA_|PATH$|HOME$|USERPROFILE$)/

export function customAcpAgentNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !NAME.test(name)) {
    return 'A custom agent name is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit.'
  }
  return isTuiAgent(name)
    ? `${name} is a built-in agent id; pick another name for the custom agent.`
    : null
}

export function customAcpEnvNameProblem(name: string): string | null {
  if (!ENV_NAME.test(name)) {
    return `${name} is not a valid environment variable name.`
  }
  return RESERVED_ENV.test(name) ? `${name} is set by Orca and cannot be given to an agent.` : null
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/** Why `agent` cannot be saved, or null when it can. */
export function customAcpAgentProblem(agent: ForkCustomAcpAgent): string | null {
  const name = customAcpAgentNameProblem(agent.name)
  if (name) {
    return name
  }
  const command = agent.command.trim()
  if (
    !command ||
    command.length > CUSTOM_ACP_AGENT_LIMITS.commandChars ||
    /[\0\n\r]/.test(command)
  ) {
    return 'The command must be one program: an absolute path or a name on PATH.'
  }
  const args = agent.args ?? []
  if (
    args.length > CUSTOM_ACP_AGENT_LIMITS.args ||
    args.some((arg) => arg.length > CUSTOM_ACP_AGENT_LIMITS.argChars || arg.includes('\0'))
  ) {
    return `At most ${CUSTOM_ACP_AGENT_LIMITS.args} arguments, each under ${CUSTOM_ACP_AGENT_LIMITS.argChars} characters.`
  }
  if (agent.cwd !== undefined && !isAbsolutePath(agent.cwd)) {
    return 'The working folder must be an absolute path.'
  }
  const env = agent.env ?? []
  if (env.length > CUSTOM_ACP_AGENT_LIMITS.env) {
    return `At most ${CUSTOM_ACP_AGENT_LIMITS.env} environment variables.`
  }
  return env.map(customAcpEnvNameProblem).find((problem) => problem !== null) ?? null
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined
}

/** The saved agents a host can run: malformed entries and later duplicates of a name are dropped. */
export function normalizeForkCustomAcpAgents(value: unknown): ForkCustomAcpAgent[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const agents: ForkCustomAcpAgent[] = []
  for (const entry of value.slice(0, CUSTOM_ACP_AGENT_LIMITS.agents)) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const raw: Record<string, unknown> = Object.fromEntries(Object.entries(entry))
    if (typeof raw.name !== 'string' || typeof raw.command !== 'string') {
      continue
    }
    const args = stringList(raw.args)
    const env = stringList(raw.env)
    const agent: ForkCustomAcpAgent = {
      name: raw.name,
      command: raw.command,
      ...(args?.length ? { args } : {}),
      ...(typeof raw.cwd === 'string' && raw.cwd ? { cwd: raw.cwd } : {}),
      ...(env?.length ? { env } : {}),
      ...(raw.ownsPrompt === true ? { ownsPrompt: true } : {})
    }
    if (seen.has(agent.name) || customAcpAgentProblem(agent) !== null) {
      continue
    }
    seen.add(agent.name)
    agents.push(agent)
  }
  return agents
}
