import { describe, expect, it } from 'vitest'
import {
  parseDarwinSysctl,
  parseLinuxMeminfo,
  parseLinuxPressure,
  parseSmapsRollup,
  parseVmStat,
  pressureFromAvailable
} from './system-memory'
import { normalizeProcessName, parseForkPsOutput } from './process-table'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5000.
Pages active:                            400000.
Pages wired down:                        200000.
Pages purgeable:                           5000.
Anonymous pages:                        1000000.
Pages occupied by compressor:            300000.
`

describe('macOS system memory', () => {
  it('reads the page counts Memory Used is built from', () => {
    expect(parseVmStat(VM_STAT)).toEqual({
      pageSize: 16384,
      anonymous: 1_000_000,
      purgeable: 5000,
      wired: 200_000,
      compressorOccupied: 300_000
    })
  })

  it('rejects vm_stat output missing a field', () => {
    expect(parseVmStat(VM_STAT.replace(/^Anonymous.*$/m, ''))).toBeNull()
  })

  it('reads swap and the kernel pressure level from one sysctl', () => {
    const out =
      'vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)\n' +
      'kern.memorystatus_vm_pressure_level: 4\n'
    expect(parseDarwinSysctl(out)).toEqual({
      swapTotal: 2048 * 1024 * 1024,
      swapUsed: Math.round(1024.5 * 1024 * 1024),
      pressure: 'critical'
    })
    expect(parseDarwinSysctl('kern.memorystatus_vm_pressure_level: 1').pressure).toBe('normal')
    expect(parseDarwinSysctl('kern.memorystatus_vm_pressure_level: 2').pressure).toBe('warn')
    expect(parseDarwinSysctl('')).toEqual({ swapTotal: null, swapUsed: null, pressure: 'unknown' })
  })
})

describe('Linux system memory', () => {
  it('reads meminfo', () => {
    const info = parseLinuxMeminfo(
      'MemTotal:       16000000 kB\nMemAvailable:    4000000 kB\nSwapTotal:       2000000 kB\nSwapFree:         500000 kB\nZswap:            100000 kB\n'
    )
    expect(info).toEqual({
      total: 16_000_000 * 1024,
      available: 4_000_000 * 1024,
      swapTotal: 2_000_000 * 1024,
      swapFree: 500_000 * 1024,
      zswap: 100_000 * 1024
    })
    expect(parseLinuxMeminfo('MemTotal: 1 kB\n')).toBeNull()
  })

  it('turns PSI stall time into a level', () => {
    const psi = (some: number, full: number) =>
      `some avg10=${some} avg60=0.00 avg300=0.00 total=1\nfull avg10=${full} avg60=0.00 avg300=0.00 total=1\n`
    expect(parseLinuxPressure(psi(0.5, 0))).toBe('normal')
    expect(parseLinuxPressure(psi(12, 2))).toBe('warn')
    expect(parseLinuxPressure(psi(12, 15))).toBe('critical')
    expect(parseLinuxPressure(psi(45, 0))).toBe('critical')
    expect(parseLinuxPressure('')).toBe('unknown')
  })

  it('judges pressure from available memory when the kernel gives none', () => {
    expect(pressureFromAvailable(100, 50)).toBe('normal')
    expect(pressureFromAvailable(100, 8)).toBe('warn')
    expect(pressureFromAvailable(100, 3)).toBe('critical')
    expect(pressureFromAvailable(0, 0)).toBe('unknown')
  })

  it('reads PSS plus swapped PSS', () => {
    expect(parseSmapsRollup('Rss:  900 kB\nPss:  600 kB\nSwapPss:  50 kB\n')).toBe(650 * 1024)
    expect(parseSmapsRollup('Pss:  600 kB\n')).toBe(600 * 1024)
    expect(parseSmapsRollup('Rss: 1 kB\n')).toBeNull()
  })
})

describe('process table', () => {
  it('parses pid, ppid, pgid, cpu, rss and the name, with spaces in paths', () => {
    const rows = parseForkPsOutput(
      [
        '    1     0     1   0.0  12000 /sbin/launchd',
        '  300   200   300   1,5   4096 -zsh',
        '  301   300   301  12.0 614400 /Users/someone/Application Support/bin/claude',
        'garbage'
      ].join('\n')
    )
    expect(rows).toEqual([
      { pid: 1, ppid: 0, pgid: 1, cpu: 0, memory: 12000 * 1024, name: 'launchd' },
      { pid: 300, ppid: 200, pgid: 300, cpu: 1.5, memory: 4096 * 1024, name: 'zsh' },
      { pid: 301, ppid: 300, pgid: 301, cpu: 12, memory: 614400 * 1024, name: 'claude' }
    ])
  })

  it('normalizes names across platforms', () => {
    expect(normalizeProcessName('C:\\Tools\\Codex.EXE')).toBe('codex')
    expect(normalizeProcessName('-bash')).toBe('bash')
    expect(normalizeProcessName('')).toBe('')
  })
})
