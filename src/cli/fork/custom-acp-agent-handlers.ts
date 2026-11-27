// BAD-873 (FORK.md "Custom ACP agents"): `orca agent custom add|list|remove`, and `orca agent
// launch --agent <custom name>`, through the host's fork.customAcpAgents.* methods.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import {
  getOptionalJsonFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type {
  ForkCustomAcpAgentRow,
  ForkCustomAcpAgentsListResult
} from '../../shared/fork/custom-acp-agents/custom-acp-agents-wire'
import { customAcpEnvNameProblem } from '../../shared/fork/custom-acp-agents/custom-acp-agent-types'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

/** `orca agent custom` needs a host with this fork's methods. */
export async function callCustomAcp<T>(
  ctx: Pick<HandlerContext, 'client'>,
  method: string,
  params?: unknown
): Promise<RuntimeRpcSuccess<T>> {
  return ctx.client.call<T>(method, params).catch((error: unknown) => {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host has no custom agents. Update Orca on the execution host and try again.'
      )
    }
    throw error
  })
}

const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

function unquoted(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length >= 2
    ? trimmed.slice(1, -1)
    : trimmed
}

/** NAME=VALUE lines; blank lines and `#` comments are skipped, `export ` and quotes allowed. */
export function parseCustomAcpEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      return
    }
    const match = ENV_LINE.exec(line)
    if (!match) {
      throw invalid(`Line ${index + 1} of the env file is not NAME=VALUE.`)
    }
    env[match[1]] = unquoted(match[2])
  })
  return env
}

function expandHome(path: string, cwd: string): string {
  const home = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
  return isAbsolute(home) ? home : resolve(cwd, home)
}

/** The variables `--env` names (valued from this shell) and `--env-file` holds. A NAME=VALUE in
 *  argv is refused: it would sit in shell history and the process list. */
export async function readCustomAcpEnv(
  flags: Map<string, string | boolean>,
  cwd: string,
  shell: NodeJS.ProcessEnv = process.env
): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  const file = getOptionalStringFlag(flags, 'env-file')
  if (file) {
    Object.assign(env, parseCustomAcpEnvFile(await readFile(expandHome(file, cwd), 'utf8')))
  }
  for (const name of getRepeatedStringFlag(flags, 'env')) {
    if (name.includes('=')) {
      throw invalid(
        `--env takes a variable name only; give ${name.slice(0, name.indexOf('='))} its value in this shell or in --env-file, never on the command line.`
      )
    }
    const value = shell[name]
    if (value === undefined) {
      throw invalid(`${name} is not set in this shell; set it or put it in --env-file.`)
    }
    env[name] = value
  }
  const problem = Object.keys(env).map(customAcpEnvNameProblem).find(Boolean)
  if (problem) {
    throw invalid(problem)
  }
  return env
}

function readArgsJson(flags: Map<string, string | boolean>): string[] {
  const text = getOptionalJsonFlag(flags, 'args-json')
  if (text === undefined) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== 'string')) {
    throw invalid('--args-json takes a JSON array of strings.')
  }
  return parsed.filter((arg): arg is string => typeof arg === 'string')
}

function readArgs(flags: Map<string, string | boolean>): string[] {
  return [...getRepeatedStringFlag(flags, 'arg'), ...readArgsJson(flags)]
}

function formatRow(agent: ForkCustomAcpAgentRow): string {
  const line = [agent.command, ...(agent.args ?? [])].join(' ')
  return [
    `${agent.name}: ${line}`,
    ...(agent.cwd ? [`  folder: ${agent.cwd}`] : []),
    ...(agent.env?.length ? [`  env: ${agent.env.join(', ')}`] : []),
    ...(agent.envMissing?.length ? [`  env without a value: ${agent.envMissing.join(', ')}`] : []),
    ...(agent.ownsPrompt ? ['  keeps its own persona (--owns-prompt)'] : [])
  ].join('\n')
}

export function formatCustomAcpAgents(result: ForkCustomAcpAgentsListResult): string {
  return result.agents.length === 0
    ? 'No custom agents. Add one with orca agent custom add <name> --command <program>.'
    : result.agents.map(formatRow).join('\n')
}

export const FORK_CUSTOM_ACP_AGENT_HANDLERS: Record<string, CommandHandler> = {
  'agent custom list': async (ctx) => {
    const listed = await callCustomAcp<ForkCustomAcpAgentsListResult>(
      ctx,
      'fork.customAcpAgents.list',
      {}
    )
    printResult(listed, ctx.json, formatCustomAcpAgents)
  },
  'agent custom add': async (ctx) => {
    const cwd = getOptionalStringFlag(ctx.flags, 'cwd')
    const env = await readCustomAcpEnv(ctx.flags, ctx.cwd)
    const args = readArgs(ctx.flags)
    const saved = await callCustomAcp<{ agent: ForkCustomAcpAgentRow }>(
      ctx,
      'fork.customAcpAgents.add',
      {
        name: getRequiredStringFlag(ctx.flags, 'name'),
        command: getRequiredStringFlag(ctx.flags, 'command'),
        ...(args.length ? { args } : {}),
        ...(cwd ? { cwd } : {}),
        ...(Object.keys(env).length ? { env } : {}),
        ...(ctx.flags.has('owns-prompt') ? { ownsPrompt: true } : {}),
        ...(ctx.flags.has('replace') ? { replace: true } : {})
      }
    )
    printResult(saved, ctx.json, (result) => `Saved ${formatRow(result.agent)}`)
  },
  'agent custom remove': async (ctx) => {
    const name = getRequiredStringFlag(ctx.flags, 'name')
    const removed = await callCustomAcp<{ removed: boolean }>(ctx, 'fork.customAcpAgents.remove', {
      name
    })
    printResult(removed, ctx.json, (result) =>
      result.removed ? `Removed ${name}.` : `No custom agent named ${name}.`
    )
  }
}
