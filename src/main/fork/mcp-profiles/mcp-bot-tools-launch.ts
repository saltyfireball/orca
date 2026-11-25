// FORK.md "Bot tools off Claude's argv" (BAD-821): the SDK turns `mcpServers` into one
// `--mcp-config <json>` argument, which `ps` shows every account on the host, and a stdio tool's
// env values ride in it. Every Claude launch through the stream-json connection (bot chats and
// the tool check) instead gets those servers in a private launch file (mcp-launch-files.ts), merged
// with the --mcp-config the launch already names (an MCP profile's file or the user's own), and the
// file goes when that Claude exits. A file that cannot be written leaves the tools out, said in the
// session's instructions; they never go back on argv.
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { botToolsOffInstruction } from '../../bots/bot-launch-tools'
import {
  FORK_MCP_BOT_FILE_PREFIX,
  removeLaunchMcpConfig,
  writeLaunchMcpConfig
} from './mcp-launch-files'
import { forkMcpLoadedState } from './mcp-profiles-service'

type LaunchMcpOptions = Pick<Options, 'mcpServers' | 'extraArgs' | 'systemPrompt'>

export type ForkClaudeMcpDelivery<T> = {
  options: T
  /** Wraps the connection's exit handler so the launch file goes first. */
  onExit: (then: () => void) => () => void
}

const CONFIG = 'mcp-config'
const OFF_REASON = 'Orca could not write the private file that hands them to Claude'
const unchanged = (then: () => void): (() => void) => then

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The servers of the launch's own `--mcp-config` (inline JSON or a file), which this replaces. */
async function namedServers(
  value: string | null | undefined,
  cwd: string
): Promise<[string, Record<string, unknown>][]> {
  if (!value) {
    return []
  }
  const text = value.trim().startsWith('{') ? value : await readFile(resolve(cwd, value), 'utf8')
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error('The launch names an MCP config without mcpServers.')
  }
  return Object.entries(parsed.mcpServers).filter(
    (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])
  )
}

function withToolsOffNote(prompt: Options['systemPrompt']): Options['systemPrompt'] {
  const note = botToolsOffInstruction(OFF_REASON)
  if (typeof prompt === 'string') {
    return `${prompt}\n\n${note}`
  }
  if (Array.isArray(prompt)) {
    return [...prompt, note]
  }
  if (prompt?.type === 'custom') {
    return { ...prompt, prompt: [prompt.prompt, note].flat() }
  }
  const base = prompt ?? { type: 'preset' as const, preset: 'claude_code' as const }
  return { ...base, append: [base.append, note].filter(Boolean).join('\n\n') }
}

export async function forkClaudeMcpOffArgv<T extends LaunchMcpOptions>(launch: {
  options: T
  cwd: string
}): Promise<ForkClaudeMcpDelivery<T>> {
  const entries = Object.entries(launch.options.mcpServers ?? {})
  // An in-process (sdk) server carries no values and is served over the SDK's own channel.
  const moved = entries.filter(([, config]) => config.type !== 'sdk')
  if (moved.length === 0) {
    return { options: launch.options, onExit: unchanged }
  }
  const sdk = entries.filter(([, config]) => config.type === 'sdk')
  const kept: Record<string, McpServerConfig> | undefined =
    sdk.length > 0 ? Object.fromEntries(sdk) : undefined
  const extraArgs = launch.options.extraArgs
  try {
    const state = await forkMcpLoadedState()
    if (!state) {
      throw new Error('This host has no MCP launch folder.')
    }
    const servers = new Map<string, Record<string, unknown>>([
      ...(await namedServers(extraArgs?.[CONFIG], launch.cwd)),
      ...moved
    ])
    const fileId = `${FORK_MCP_BOT_FILE_PREFIX}${randomBytes(12).toString('hex')}`
    const file = await writeLaunchMcpConfig(state.launchFolder, fileId, servers)
    return {
      options: { ...launch.options, mcpServers: kept, extraArgs: { ...extraArgs, [CONFIG]: file } },
      onExit: (then) => () => {
        void removeLaunchMcpConfig(state.launchFolder, fileId).catch(() => undefined)
        then()
      }
    }
  } catch (error) {
    // The message only: server definitions never reach a log.
    console.warn('[fork-bot-tools] tools left out of the launch', (error as Error).message)
    return {
      options: {
        ...launch.options,
        mcpServers: kept,
        systemPrompt: withToolsOffNote(launch.options.systemPrompt)
      },
      onExit: unchanged
    }
  }
}
