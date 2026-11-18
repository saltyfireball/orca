// Server memory protection (SLRM-2384, FORK.md): the handlers and their text output.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  parseServeProtectOomScore,
  parseServeProtectSize,
  SERVE_PROTECT_DEFAULT_CHILD_OOM,
  SERVE_PROTECT_DEFAULT_MEMORY_LOW,
  SERVE_PROTECT_DEFAULT_MEMORY_MIN,
  SERVE_PROTECT_DEFAULT_SYSTEM_OOM
} from '../../shared/fork/serve-protect'
import {
  protectServeService,
  readServeProtectStatus,
  unprotectServeService,
  type ServeProtectOptions
} from './serve-protect'

function invalid(flag: string, expected: string): never {
  throw new RuntimeClientError('invalid_argument', `--${flag} takes ${expected}.`)
}

function size(flags: Map<string, string | boolean>, flag: string, fallback: string): string | null {
  const parsed = parseServeProtectSize(getOptionalStringFlag(flags, flag) ?? fallback)
  return parsed === undefined ? invalid(flag, 'a size such as 512M or 2G, or off') : parsed
}

function score(
  flags: Map<string, string | boolean>,
  flag: string,
  fallback: number
): number | null {
  const parsed = parseServeProtectOomScore(getOptionalStringFlag(flags, flag) ?? String(fallback))
  return parsed === undefined ? invalid(flag, 'a whole number from -1000 to 1000, or off') : parsed
}

export function readServeProtectOptions(flags: Map<string, string | boolean>): ServeProtectOptions {
  const rawOom = getOptionalStringFlag(flags, 'oom-score-adjust') ?? 'auto'
  const system = score(flags, 'system-oom-score-adjust', SERVE_PROTECT_DEFAULT_SYSTEM_OOM)
  return {
    memoryMin: size(flags, 'memory-min', SERVE_PROTECT_DEFAULT_MEMORY_MIN),
    memoryLow: size(flags, 'memory-low', SERVE_PROTECT_DEFAULT_MEMORY_LOW),
    oomScoreAdjust:
      rawOom.trim().toLowerCase() === 'auto' ? 'auto' : score(flags, 'oom-score-adjust', 0),
    childOomScoreAdjust: score(flags, 'child-oom-score-adjust', SERVE_PROTECT_DEFAULT_CHILD_OOM),
    systemOomScoreAdjust: system ?? invalid('system-oom-score-adjust', 'a whole number'),
    dryRun: flags.get('dry-run') === true
  }
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function formatServeProtect(result: Record<string, unknown>): string {
  const lines: string[] = []
  const verb = result.dryRun ? 'Would write' : 'Wrote'
  lines.push(`${verb} ${String(result.dropInPath)}:`, '', String(result.content).trimEnd())
  if (result.sliceDropInPath) {
    lines.push(
      '',
      `${verb} ${String(result.sliceDropInPath)}:`,
      '',
      String(result.sliceContent).trimEnd()
    )
  }
  lines.push('', ...list(result.notes))
  if (!result.dryRun) {
    lines.push(
      'Memory protection is on now. The OOM scores apply at the next start of the service (terminals keep running):',
      `  ${String(result.restartCommand)}`
    )
  }
  const steps = list(result.rootSteps)
  lines.push(
    '',
    steps.length === 0
      ? 'No root steps needed: the parent slices, tailscaled and sshd already hold enough.'
      : 'Steps that need root, not run (run them yourself to protect the parent slices, tailscaled and sshd):'
  )
  lines.push(...steps.map((step) => `  ${step}`))
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
}

export function formatServeProtectStatus(result: Record<string, unknown>): string {
  const configured = (result.configured ?? {}) as Record<string, unknown>
  const lines = [
    `${String(result.name)}: ${result.protected ? (result.dropInLoaded ? 'protected' : 'drop-in written, not loaded yet (systemctl --user daemon-reload)') : 'not protected'}`,
    `Unit: OOMScoreAdjust=${String(configured.oomScoreAdjust)} MemoryMin=${String(configured.memoryMin)} MemoryLow=${String(configured.memoryLow)}`,
    `Running server score: ${result.serverOomScore === null ? 'not running' : String(result.serverOomScore)}; user manager floor: ${result.userManagerFloor === null ? 'unknown' : String(result.userManagerFloor)}`
  ]
  for (const unit of Array.isArray(result.system) ? result.system : []) {
    const entry = unit as Record<string, unknown>
    lines.push(
      `${String(entry.unit)}: OOMScoreAdjust=${String(entry.oomScoreAdjust)} MemoryMin=${String(entry.memoryMin)} MemoryLow=${String(entry.memoryLow)}`
    )
  }
  return lines.join('\n')
}

function emit(
  result: Record<string, unknown>,
  json: boolean,
  format: (value: Record<string, unknown>) => string
): void {
  console.log(json ? JSON.stringify({ ok: true, result }, null, 2) : format(result))
}

export const FORK_SERVE_PROTECT_HANDLERS: Record<string, CommandHandler> = {
  'serve service protect': async ({ flags, json }) => {
    emit(await protectServeService(readServeProtectOptions(flags)), json, formatServeProtect)
  },
  'serve service protect status': async ({ json }) => {
    emit(await readServeProtectStatus(), json, formatServeProtectStatus)
  },
  'serve service unprotect': async ({ json }) => {
    emit(await unprotectServeService(), json, (value) =>
      value.removed
        ? `Removed ${String(value.dropInPath)}${value.sliceDropInPath ? ` and ${String(value.sliceDropInPath)}` : ''}; memory protection is off now. Scores go back at the next start: ${String(value.restartCommand)}`
        : `${String(value.name)} had no protect drop-in.`
    )
  }
}
