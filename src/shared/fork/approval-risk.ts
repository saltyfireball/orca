// Approval triage (FORK.md, SLRM-2397): grade a tool approval prompt low, medium or high from
// what the card shows (its title and its detail, the tool's input) and the folder the agent works
// in. Low is only a read inside that folder, or an edit of an ordinary file in it. Writing
// outside it, the network, deleting, git and GitHub writes and credentials are never low;
// anything unrecognized is medium. Only `low` may ever be allowed in bulk.
import { placePath } from './approval-risk-paths'
import {
  gradeShellCommand,
  worseGrade,
  type ForkApprovalGrade,
  type ForkApprovalRisk
} from './approval-risk-shell'

export type { ForkApprovalGrade, ForkApprovalRisk } from './approval-risk-shell'

export type ForkApprovalInput = {
  title: string
  detail?: string | null
  /** The folder the agent works in; null when the window cannot tell. */
  cwd: string | null
}

const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit'])
const READ_TOOLS = new Set(['read', 'notebookread', 'ls', 'grep', 'glob'])
const NETWORK_TOOLS = new Set(['webfetch', 'websearch'])
const ACTING_MCP =
  /(send|post|delete|remove|create|write|update|push|merge|publish|deploy|exec|run|kill|move|rename|upload|pay|transfer)/i

const medium = (reason: string): ForkApprovalGrade => ({ risk: 'medium', reason })
const high = (reason: string): ForkApprovalGrade => ({ risk: 'high', reason })

/** The tool named by a stock title ("Allow Bash?"), lower case; null for any other title. */
export function approvalToolName(title: string): string | null {
  const match = /^Allow ([A-Za-z0-9_.:-]+)\?$/.exec(title.trim())
  return match ? match[1] : null
}

function parseInput(detail: string | null | undefined): Record<string, unknown> | string | null {
  if (!detail) {
    return null
  }
  const text = detail.trim()
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return text
}

function text(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') {
      return value
    }
  }
  return null
}

function gradeFile(path: string, write: boolean, cwd: string | null): ForkApprovalGrade {
  const place = placePath(path, cwd, cwd)
  if (place === 'sensitive') {
    return high(`${write ? 'writes' : 'reads'} ${path}, a credential or configuration file`)
  }
  if (place === 'outside') {
    return write
      ? high(`writes ${path}, outside the workspace`)
      : medium(`reads ${path}, outside the workspace`)
  }
  return { risk: 'low', reason: write ? 'edits a file in the workspace' : 'reads the workspace' }
}

function gradeRecord(tool: string | null, input: Record<string, unknown>, cwd: string | null) {
  const name = tool?.toLowerCase() ?? null
  if (input.dangerouslyDisableSandbox === true) {
    return high('asks to run outside the sandbox')
  }
  const command = text(input, 'command', 'cmd')
  if (name === 'bash' || (name === null && command !== null)) {
    return command === null ? medium('a command it cannot read') : gradeShellCommand(command, cwd)
  }
  if (name?.startsWith('mcp__')) {
    return ACTING_MCP.test(name)
      ? high('an MCP tool that sends or changes something')
      : medium('an MCP tool')
  }
  if (name !== null && NETWORK_TOOLS.has(name)) {
    return medium('reaches the network')
  }
  const path = text(input, 'file_path', 'notebook_path', 'path')
  const writes =
    (name !== null && WRITE_TOOLS.has(name)) ||
    (name === null &&
      ['content', 'old_string', 'new_string', 'edits', 'new_source'].some((k) => k in input))
  if (writes) {
    return path === null ? medium('an edit without a file') : gradeFile(path, true, cwd)
  }
  if ((name !== null && READ_TOOLS.has(name)) || (name === null && (path || input.pattern))) {
    const pattern = text(input, 'pattern')
    let grade = gradeFile(path ?? '.', false, cwd)
    if (
      name === 'glob' &&
      pattern &&
      (pattern.startsWith('/') || pattern.includes('..') || pattern.includes('{'))
    ) {
      grade = worseGrade(grade, medium('a pattern that may reach outside the workspace'))
    }
    return grade
  }
  return medium(name ? `${tool} is not graded` : 'a request it cannot read')
}

/** The grade of one approval prompt. */
export function gradeForkApproval(input: ForkApprovalInput): ForkApprovalGrade {
  const tool = approvalToolName(input.title)
  const parsed = parseInput(input.detail)
  if (parsed === null) {
    return medium('nothing to read')
  }
  if (typeof parsed === 'string') {
    // A provider that sends the bare command (Codex's "Run a command?").
    const isCommand = tool?.toLowerCase() === 'bash' || /\bcommand\b/i.test(input.title)
    return isCommand ? gradeShellCommand(parsed, input.cwd) : medium('a request it cannot read')
  }
  return gradeRecord(tool, parsed, input.cwd)
}

export function isForkApprovalLowRisk(input: ForkApprovalInput): boolean {
  return gradeForkApproval(input).risk === 'low'
}

export function forkApprovalRiskRank(risk: ForkApprovalRisk): number {
  return risk === 'low' ? 0 : risk === 'medium' ? 1 : 2
}
