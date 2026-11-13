// SLRM-2099: system memory as the OS reports it: used, compressed, swap and the pressure level.
// macOS: one `vm_stat` and one `sysctl`. Linux: /proc/meminfo and /proc/pressure/memory (no spawn).
// Windows: Node's totals only, with pressure judged from available memory.
import { runProcess } from '@orca/process-host'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import type { ForkMemoryPressureLevel, ForkSystemMemory } from '../../../shared/fork/memory-truth'

const SPAWN_TIMEOUT_MS = 2_000
const SPAWN_MAX_BUFFER = 256 * 1024
const KIB = 1024
const MIB = 1024 ** 2

/** `vm_stat`: page size and the page counts Activity Monitor's Memory Used is built from. */
export function parseVmStat(stdout: string): {
  pageSize: number
  anonymous: number
  purgeable: number
  wired: number
  compressorOccupied: number
} | null {
  const pageSize = Number.parseInt(/page size of (\d+) bytes/.exec(stdout)?.[1] ?? '', 10)
  const pages = (label: string): number => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(stdout)
    return match ? Number.parseInt(match[1], 10) : Number.NaN
  }
  const result = {
    pageSize,
    anonymous: pages('Anonymous pages'),
    purgeable: pages('Pages purgeable'),
    wired: pages('Pages wired down'),
    compressorOccupied: pages('Pages occupied by compressor')
  }
  return Object.values(result).every((value) => Number.isFinite(value) && value >= 0) &&
    pageSize > 0
    ? result
    : null
}

/** `sysctl vm.swapusage kern.memorystatus_vm_pressure_level` (name: value lines). */
export function parseDarwinSysctl(stdout: string): {
  swapUsed: number | null
  swapTotal: number | null
  pressure: ForkMemoryPressureLevel
} {
  const swap = /vm\.swapusage:\s*total = ([\d.]+)M\s+used = ([\d.]+)M/.exec(stdout)
  const level = Number.parseInt(
    /kern\.memorystatus_vm_pressure_level:\s*(\d+)/.exec(stdout)?.[1] ?? '',
    10
  )
  // The kernel's levels: 1 normal, 2 warn, 4 critical.
  const pressure: ForkMemoryPressureLevel =
    level === 1 ? 'normal' : level === 2 ? 'warn' : level === 4 ? 'critical' : 'unknown'
  return {
    swapTotal: swap ? Math.round(Number.parseFloat(swap[1]) * MIB) : null,
    swapUsed: swap ? Math.round(Number.parseFloat(swap[2]) * MIB) : null,
    pressure
  }
}

export function parseLinuxMeminfo(meminfo: string): {
  total: number
  available: number
  swapTotal: number | null
  swapFree: number | null
  zswap: number | null
} | null {
  const kib = (label: string): number | null => {
    const match = new RegExp(`^${label}:\\s*(\\d+)\\s+kB$`, 'm').exec(meminfo)
    return match ? Number.parseInt(match[1], 10) * KIB : null
  }
  const total = kib('MemTotal')
  const available = kib('MemAvailable')
  if (total === null || available === null) {
    return null
  }
  return {
    total,
    available,
    swapTotal: kib('SwapTotal'),
    swapFree: kib('SwapFree'),
    zswap: kib('Zswap')
  }
}

/** PSI `some avg10` / `full avg10` (percent of time stalled on memory over 10 s). */
export function parseLinuxPressure(psi: string): ForkMemoryPressureLevel {
  const avg = (kind: string): number | null => {
    const match = new RegExp(`^${kind} avg10=([\\d.]+)`, 'm').exec(psi)
    return match ? Number.parseFloat(match[1]) : null
  }
  const some = avg('some')
  const full = avg('full')
  if (some === null && full === null) {
    return 'unknown'
  }
  if ((full ?? 0) >= 10 || (some ?? 0) >= 40) {
    return 'critical'
  }
  return (some ?? 0) >= 10 ? 'warn' : 'normal'
}

/** Without a kernel signal: under 10% available is warn, under 5% critical. */
export function pressureFromAvailable(total: number, available: number): ForkMemoryPressureLevel {
  if (total <= 0) {
    return 'unknown'
  }
  const ratio = available / total
  return ratio < 0.05 ? 'critical' : ratio < 0.1 ? 'warn' : 'normal'
}

async function run(program: string, args: string[]): Promise<string | null> {
  try {
    const result = await runProcess({
      program,
      args,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      maxOutputBytes: SPAWN_MAX_BUFFER,
      timeoutMs: SPAWN_TIMEOUT_MS
    })
    // sysctl exits non-zero when one name is unknown but still prints the others.
    return result.timedOut ? null : result.stdout
  } catch {
    return null
  }
}

async function readDarwin(now: number): Promise<ForkSystemMemory> {
  const total = os.totalmem()
  const [vmStat, sysctl] = await Promise.all([
    run('/usr/bin/vm_stat', []),
    run('/usr/sbin/sysctl', ['vm.swapusage', 'kern.memorystatus_vm_pressure_level'])
  ])
  const pages = vmStat ? parseVmStat(vmStat) : null
  const swap = parseDarwinSysctl(sysctl ?? '')
  const used = pages
    ? (Math.max(0, pages.anonymous - pages.purgeable) + pages.wired + pages.compressorOccupied) *
      pages.pageSize
    : total - os.freemem()
  return {
    total,
    used: Math.min(total, Math.max(0, used)),
    compressed: pages ? pages.compressorOccupied * pages.pageSize : null,
    swapUsed: swap.swapUsed,
    swapTotal: swap.swapTotal,
    pressure: swap.pressure,
    sampledAt: now
  }
}

async function readLinux(now: number): Promise<ForkSystemMemory> {
  const [meminfo, psi] = await Promise.all([
    readFile('/proc/meminfo', 'utf8').catch(() => null),
    readFile('/proc/pressure/memory', 'utf8').catch(() => null)
  ])
  const info = meminfo ? parseLinuxMeminfo(meminfo) : null
  if (!info) {
    return readGeneric(now)
  }
  const fromPsi = psi ? parseLinuxPressure(psi) : 'unknown'
  return {
    total: info.total,
    used: Math.max(0, info.total - info.available),
    compressed: info.zswap,
    swapUsed:
      info.swapTotal !== null && info.swapFree !== null
        ? Math.max(0, info.swapTotal - info.swapFree)
        : null,
    swapTotal: info.swapTotal,
    pressure: fromPsi === 'unknown' ? pressureFromAvailable(info.total, info.available) : fromPsi,
    sampledAt: now
  }
}

function readGeneric(now: number): ForkSystemMemory {
  const total = os.totalmem()
  const free = Math.min(total, os.freemem())
  return {
    total,
    used: total - free,
    compressed: null,
    swapUsed: null,
    swapTotal: null,
    pressure: pressureFromAvailable(total, free),
    sampledAt: now
  }
}

export async function readForkSystemMemory(
  platform: NodeJS.Platform = os.platform(),
  now = Date.now()
): Promise<ForkSystemMemory> {
  if (platform === 'darwin') {
    return readDarwin(now)
  }
  if (platform === 'linux') {
    return readLinux(now)
  }
  return readGeneric(now)
}

/** `/proc/<pid>/smaps_rollup`: Pss plus SwapPss, so swapped-out memory still counts. */
export function parseSmapsRollup(text: string): number | null {
  const kib = (label: string): number | null => {
    const match = new RegExp(`^${label}:\\s*(\\d+)\\s+kB$`, 'm').exec(text)
    return match ? Number.parseInt(match[1], 10) * KIB : null
  }
  const pss = kib('Pss')
  return pss === null ? null : pss + (kib('SwapPss') ?? 0)
}

/** PSS for the given pids; pids it cannot read are left out (the caller keeps RSS for them). */
export async function readLinuxPss(pids: Iterable<number>): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  await Promise.all(
    [...pids].map(async (pid) => {
      const text = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8').catch(() => null)
      const bytes = text ? parseSmapsRollup(text) : null
      if (bytes !== null) {
        result.set(pid, bytes)
      }
    })
  )
  return result
}
