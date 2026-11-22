// Agent slice limits (BAD-684, FORK.md): the terminal host's per-daemon systemd slice holds every
// terminal scope, so limits on the slice cap all agents together and keep the server, Tailscale
// and SSH responsive. Linux only, opt-in, best effort: a property the host does not enforce is
// skipped and logged, and nothing here can fail a launch.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMemorySize } from '../../daemon/process-scopes/terminal-memory-limits'

export const AGENT_SLICE_ENV = 'ORCA_AGENT_SLICE'
export const AGENT_SLICE_CPU_WEIGHT_ENV = 'ORCA_AGENT_SLICE_CPU_WEIGHT'
export const AGENT_SLICE_IO_WEIGHT_ENV = 'ORCA_AGENT_SLICE_IO_WEIGHT'
export const AGENT_SLICE_TASKS_MAX_ENV = 'ORCA_AGENT_SLICE_TASKS_MAX'
export const AGENT_SLICE_MEMORY_HIGH_ENV = 'ORCA_AGENT_SLICE_MEMORY_HIGH'

/** systemd's default weight is 100; 10 lets the server and SSH win any CPU or disk contention. */
export const DEFAULT_AGENT_WEIGHT = 10
/** Of the kernel's task limit: generous enough that no normal build or test run reaches it. */
const TASKS_SHARE = 0.25
const MEMORY_HIGH_RAM_SHARE = 0.75
const MEMORY_HIGH_SWAP_SHARE = 0.25
const MIN_MEMORY_HIGH_BYTES = 512 * 1024 ** 2

export type AgentSliceFacts = {
  ramBytes: number
  swapBytes: number
  pidMax: number
}

export type AgentSliceRequest = {
  /** `--property=`-style assignments for `systemctl set-property`. */
  properties: string[]
  invalid: string[]
}

const isOn = (raw: string | undefined): boolean => /^(1|true|on|yes)$/i.test((raw ?? '').trim())

function weight(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_AGENT_WEIGHT
  }
  const value = Number(raw.trim())
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : null
}

/** Memory above this is throttled and reclaimed, never killed: a slowdown instead of a hang. */
export function defaultAgentMemoryHighBytes(facts: AgentSliceFacts): number {
  const bytes = facts.ramBytes * MEMORY_HIGH_RAM_SHARE + facts.swapBytes * MEMORY_HIGH_SWAP_SHARE
  return Math.max(MIN_MEMORY_HIGH_BYTES, Math.floor(bytes))
}

export function requestedAgentSliceLimits(
  env: NodeJS.ProcessEnv,
  facts: AgentSliceFacts
): AgentSliceRequest | null {
  if (!isOn(env[AGENT_SLICE_ENV])) {
    return null
  }
  const request: AgentSliceRequest = { properties: [], invalid: [] }
  for (const [name, property] of [
    [AGENT_SLICE_CPU_WEIGHT_ENV, 'CPUWeight'],
    [AGENT_SLICE_IO_WEIGHT_ENV, 'IOWeight']
  ] as const) {
    const value = weight(env, name)
    if (value === null) {
      request.invalid.push(name)
    } else {
      request.properties.push(`${property}=${value}`)
    }
  }
  const tasksRaw = env[AGENT_SLICE_TASKS_MAX_ENV]?.trim()
  const tasks = tasksRaw ? Number(tasksRaw) : Math.floor(facts.pidMax * TASKS_SHARE)
  if (Number.isSafeInteger(tasks) && tasks >= 64) {
    request.properties.push(`TasksMax=${tasks}`)
  } else {
    request.invalid.push(AGENT_SLICE_TASKS_MAX_ENV)
  }
  const highRaw = env[AGENT_SLICE_MEMORY_HIGH_ENV]?.trim()
  const high = highRaw ? parseMemorySize(highRaw) : defaultAgentMemoryHighBytes(facts)
  if (high !== null && high >= MIN_MEMORY_HIGH_BYTES) {
    request.properties.push(`MemoryHigh=${high}`)
  } else {
    request.invalid.push(AGENT_SLICE_MEMORY_HIGH_ENV)
  }
  return request
}

/** The cgroup file that shows the kernel enforces each property, and how it prints the value. */
const PAGE_ROUNDING_BYTES = 64 * 1024
const exactLine = (line: string, value: string): boolean => line === value
const ENFORCEMENT: Record<
  string,
  { file: string; matches: (line: string, value: string) => boolean }
> = {
  CPUWeight: { file: 'cpu.weight', matches: exactLine },
  IOWeight: { file: 'io.weight', matches: (line, value) => line === `default ${value}` },
  TasksMax: { file: 'pids.max', matches: exactLine },
  // systemd rounds a byte value down to a page.
  MemoryHigh: {
    file: 'memory.high',
    matches: (line, value) =>
      /^\d+$/.test(line) &&
      Number(value) - Number(line) >= 0 &&
      Number(value) - Number(line) < PAGE_ROUNDING_BYTES
  }
}

export type AgentSliceRunner = (args: string[]) => { code: number | null; timedOut: boolean }

export type AgentSliceReport = { applied: string[]; refused: string[] }

/** Applies each property alone so one the host refuses cannot drop the others. */
export function applyAgentSliceLimits(input: {
  slice: string
  sliceCgroupPath: string
  request: AgentSliceRequest
  run: AgentSliceRunner
  readCgroupFile?: (path: string) => string | null
}): AgentSliceReport {
  const read =
    input.readCgroupFile ??
    ((path: string) => {
      try {
        return readFileSync(path, 'utf8').trim()
      } catch {
        return null
      }
    })
  const report: AgentSliceReport = { applied: [], refused: [...input.request.invalid] }
  for (const property of input.request.properties) {
    const [name, value] = property.split('=')
    const result = input.run(['--user', 'set-property', '--runtime', input.slice, property])
    const rule = ENFORCEMENT[name]
    const shown = rule ? read(join(input.sliceCgroupPath, rule.file)) : null
    const enforced = result.code === 0 && !result.timedOut && shown !== null && rule !== undefined
    if (enforced && shown.split('\n').some((line) => rule.matches(line, value))) {
      report.applied.push(property)
    } else {
      report.refused.push(property)
    }
  }
  return report
}

export function readAgentSliceFacts(): AgentSliceFacts {
  const kib = (label: string, meminfo: string): number => {
    const match = new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(meminfo)
    return match ? Number(match[1]) * 1024 : 0
  }
  let meminfo = ''
  let pidMax = 32_768
  try {
    meminfo = readFileSync('/proc/meminfo', 'utf8')
    pidMax = Number(readFileSync('/proc/sys/kernel/pid_max', 'utf8').trim()) || pidMax
  } catch {
    // Missing /proc: the minimums apply.
  }
  return { ramBytes: kib('MemTotal', meminfo), swapBytes: kib('SwapTotal', meminfo), pidMax }
}
