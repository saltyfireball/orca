// Command guards (FORK.md, BAD-764): which tools run a shell command and where the command is in
// their input. One list for both surfaces: the terminal hook (a reply to the agent's hook post) and
// the in-Orca hook of native chats and chat workers. Pure.

/**
 * Every Claude Code tool that takes a shell command (2.1.330, read from the tools it marks as running
 * code). Each carries it as `command`: Bash (also in the background), Monitor (optional there, a
 * WebSocket watch has none) and PowerShell. Its other code-running tools take a prompt or a script
 * whose shell calls come back as calls of these (CronCreate, Workflow, REPL).
 */
export const CLAUDE_SHELL_TOOLS = ['Bash', 'Monitor', 'PowerShell'] as const

/** The names other agents use for a shell. */
const OTHER_SHELL_TOOLS = ['shell', 'run_shell_command', 'execute_bash', 'exec_command']

const SHELL_TOOLS = new Set(
  [...CLAUDE_SHELL_TOOLS, ...OTHER_SHELL_TOOLS].map((tool) => tool.toLowerCase())
)

/** The shell command a tool call runs, else null. */
export function shellCommandOfToolCall(tool: string, input: unknown): string | null {
  if (
    !SHELL_TOOLS.has(tool.toLowerCase()) ||
    typeof input !== 'object' ||
    input === null ||
    !('command' in input)
  ) {
    return null
  }
  return typeof input.command === 'string' ? input.command : null
}
