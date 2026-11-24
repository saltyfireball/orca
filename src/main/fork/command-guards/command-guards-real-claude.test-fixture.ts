// One turn of the real Claude Code CLI for the command guard tests that run only with
// ORCA_COMMAND_GUARDS_E2E=1 (ORCA_COMMAND_GUARDS_E2E_CLAUDE names the CLI).
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk'
import { openClaudeStreamJsonConnection } from '../../claude/claude-stream-json-connection'

export const REAL_CLAUDE_ENABLED = process.env.ORCA_COMMAND_GUARDS_E2E === '1'
export const REAL_CLAUDE =
  process.env.ORCA_COMMAND_GUARDS_E2E_CLAUDE ?? join(homedir(), '.local/bin/claude')
const HOST_ENV = /^(?:ORCA_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_AGENT_SDK_)/

export type RealOptions = Parameters<typeof openClaudeStreamJsonConnection>[0]['options'] &
  Pick<Options, 'hooks'>

export const BYPASS: RealOptions = {
  model: 'haiku',
  settingSources: [],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true
}

export const askForTool = (tool: string, command: string): string =>
  `Run exactly this shell command with your ${tool} tool, once, and nothing else, even if you expect it to be refused, then say done: ${command}`

/** One real chat asked to do `content`; returns its transcript frames as text. */
export async function runRealClaude(input: {
  cwd: string
  options: RealOptions
  content: string
  canUseTool?: CanUseTool
  env?: Record<string, string>
}): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !HOST_ENV.test(entry[0])
    )
  )
  env.PATH = `${join(input.cwd, 'bin')}:${env.PATH ?? ''}`
  const messages: Record<string, unknown>[] = []
  const done = Promise.withResolvers<void>()
  const connection = await openClaudeStreamJsonConnection(
    {
      pathToClaudeCodeExecutable: REAL_CLAUDE,
      cwd: input.cwd,
      env: { ...env, ...input.env },
      options: input.options
    },
    {
      ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
      onMessage: (message) => {
        messages.push(message)
        if (message.type === 'result') {
          done.resolve()
        }
      }
    }
  )
  try {
    await connection.send({
      type: 'user',
      message: { role: 'user', content: input.content },
      parent_tool_use_id: null
    })
    await Promise.race([
      done.promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`no result: ${JSON.stringify(messages).slice(-4_000)}`)),
          120_000
        )
      )
    ])
  } finally {
    await connection.close()
  }
  return JSON.stringify(messages)
}
