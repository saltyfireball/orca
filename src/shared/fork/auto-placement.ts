// Auto placement (FORK.md, SLRM-2266): each machine has a placement setting, and `--on auto` /
// `--host auto` start new work on the eligible machine with the most spare CPU and memory.
// Pure: the main process probes the machines and the CLI rewrites the flag; this file ranks them.
import { LOCAL_EXECUTION_HOST_ID, normalizeExecutionHostId } from '../execution-host'
import type { Project, ProjectHostSetup } from '../project/project-types'
import { normalizeTypedName } from '../text/typed-name-normalization'

/** How willingly a machine takes new work picked automatically. Named machines are never refused. */
export type ForkPlacementPreference = 'prefer' | 'normal' | 'less' | 'manual'

export const FORK_PLACEMENT_PREFERENCES: readonly ForkPlacementPreference[] = [
  'prefer',
  'normal',
  'less',
  'manual'
]

/** The value `--on` and `--host` take to ask for a pick. */
export const FORK_AUTO_PLACEMENT_VALUE = 'auto'

/** This machine's key in `forkPlacement`; paired servers use `runtime:<environment id>`. */
export const FORK_PLACEMENT_LOCAL_KEY = 'local'

/** Score multipliers; manual is never picked. */
const WEIGHT: Record<Exclude<ForkPlacementPreference, 'manual'>, number> = {
  prefer: 1.5,
  normal: 1,
  less: 0.5
}

export type ForkAutoPlacementSettings = {
  /** Fork auto placement: per machine ('local' or 'runtime:<environment id>'), how willingly it
   *  takes automatically placed work; unset machines are 'normal'. */
  forkPlacement?: Record<string, ForkPlacementPreference>
  /** Fork auto placement: when no machine is named and more than one could take the work, pick
   *  one as `auto` would. Off unless true. */
  forkPlacementAutoWhenUnnamed?: boolean
}

export function isForkPlacementPreference(value: unknown): value is ForkPlacementPreference {
  return typeof value === 'string' && (FORK_PLACEMENT_PREFERENCES as string[]).includes(value)
}

export function forkPlacementFor(
  settings: ForkAutoPlacementSettings | null | undefined,
  hostKey: string
): ForkPlacementPreference {
  const value = settings?.forkPlacement?.[hostKey]
  return isForkPlacementPreference(value) ? value : 'normal'
}

export function forkPlacementAutoWhenUnnamed(
  settings: ForkAutoPlacementSettings | null | undefined
): boolean {
  return settings?.forkPlacementAutoWhenUnnamed === true
}

/** The settings update that sets one machine's preference; 'normal' drops the key. */
export function withForkPlacement(
  settings: ForkAutoPlacementSettings | null | undefined,
  hostKey: string,
  preference: ForkPlacementPreference
): Record<string, ForkPlacementPreference> {
  const next = { ...settings?.forkPlacement }
  if (preference === 'normal') {
    delete next[hostKey]
  } else {
    next[hostKey] = preference
  }
  return next
}

/** One machine's load, as the probe reports it. */
export type ForkMachineLoad = {
  cpuCount: number
  /** One-minute load average; 0 where the platform has none (Windows). */
  loadAverage: number
  freeMemoryBytes: number
  totalMemoryBytes: number
}

/**
 * - eligible: could take the work; ranked by score.
 * - manual: its setting says it only takes work named for it.
 * - unreachable: the probe failed or timed out.
 * - no-probe: it answers but has no load probe (stock Orca or an older Blackfish).
 * - no-repo: the requested repo is not on it.
 * - no-setup: the requested project has no ready setup on it (or it is too old to say).
 */
export type ForkPlacementStatus =
  | 'eligible'
  | 'manual'
  | 'unreachable'
  | 'no-probe'
  | 'no-repo'
  | 'no-setup'

/** A machine as the probe saw it. */
export type ForkPlacementProbe = {
  /** 'local' or 'runtime:<environment id>'. */
  hostKey: string
  name: string
  preference: ForkPlacementPreference
  /** Null when the probe did not answer (or a manual machine was not asked); `status` says why. */
  load: ForkMachineLoad | null
  status: Exclude<ForkPlacementStatus, 'eligible' | 'manual'> | 'ok'
}

/** Load figures from untrusted JSON, or null when any is missing or not a sane number. */
export function parseForkMachineLoad(value: unknown): ForkMachineLoad | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const number = (key: keyof ForkMachineLoad): number | null => {
    const entry = raw[key]
    return typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 ? entry : null
  }
  const cpuCount = number('cpuCount')
  const loadAverage = number('loadAverage')
  const freeMemoryBytes = number('freeMemoryBytes')
  const totalMemoryBytes = number('totalMemoryBytes')
  if (cpuCount === null || loadAverage === null || freeMemoryBytes === null || !totalMemoryBytes) {
    return null
  }
  return { cpuCount, loadAverage, freeMemoryBytes, totalMemoryBytes }
}

export type ForkPlacementCandidate = {
  hostKey: string
  name: string
  preference: ForkPlacementPreference
  status: ForkPlacementStatus
  load: ForkMachineLoad | null
  /** Spare cores (cpu count less the load average, never below 0). */
  spareCores?: number
  /** Weighted share of the best spare CPU and memory among eligible machines, 0..1.5. */
  score?: number
}

export type ForkPlacementPick = {
  picked: ForkPlacementCandidate | null
  /** Every machine considered, best first; ineligible ones last. */
  ranked: ForkPlacementCandidate[]
}

function spareCores(load: ForkMachineLoad): number {
  return Math.max(0, load.cpuCount - Math.max(0, load.loadAverage))
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Ranks machines by spare CPU and memory. Each eligible machine's spare cores and free memory are
 * divided by the best among them, averaged, and multiplied by its preference weight. A machine
 * set to manual, unreachable, without the probe or without the repo is never picked. Ties keep
 * the probe order, so this machine wins a tie when it is listed first.
 */
export function pickForkPlacement(probes: readonly ForkPlacementProbe[]): ForkPlacementPick {
  const candidates: ForkPlacementCandidate[] = probes.map((probe) => {
    if (probe.preference === 'manual') {
      // Not probed at all: a manual machine is never picked, so it need not answer.
      return { ...probe, status: 'manual' }
    }
    if (probe.status !== 'ok' || !probe.load) {
      return { ...probe, status: probe.status === 'ok' ? 'unreachable' : probe.status }
    }
    return { ...probe, status: 'eligible', spareCores: spareCores(probe.load) }
  })
  const eligible = candidates.filter((candidate) => candidate.status === 'eligible')
  const bestCores = Math.max(0, ...eligible.map((c) => finite(c.spareCores ?? 0)))
  const bestMemory = Math.max(0, ...eligible.map((c) => finite(c.load?.freeMemoryBytes ?? 0)))
  for (const candidate of eligible) {
    const cpu = bestCores > 0 ? finite(candidate.spareCores ?? 0) / bestCores : 0
    const memory = bestMemory > 0 ? finite(candidate.load?.freeMemoryBytes ?? 0) / bestMemory : 0
    const weight = WEIGHT[candidate.preference as keyof typeof WEIGHT] ?? 1
    candidate.score = Math.round(((cpu + memory) / 2) * weight * 1000) / 1000
  }
  const order = new Map(candidates.map((candidate, index) => [candidate, index]))
  const ranked = [...candidates].sort((a, b) => {
    const aEligible = a.status === 'eligible' ? 1 : 0
    const bEligible = b.status === 'eligible' ? 1 : 0
    if (aEligible !== bEligible) {
      return bEligible - aEligible
    }
    const diff = (b.score ?? 0) - (a.score ?? 0)
    return diff !== 0 ? diff : (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
  return { picked: ranked[0]?.status === 'eligible' ? ranked[0] : null, ranked }
}

const GIB = 1024 ** 3

/** One line per machine, for the CLI note and `orca placement`. */
export function describeForkPlacementCandidate(candidate: ForkPlacementCandidate): string {
  const load = candidate.load
  const facts = load
    ? `${(candidate.spareCores ?? spareCores(load)).toFixed(1)} of ${load.cpuCount} cores spare, ` +
      `${(load.freeMemoryBytes / GIB).toFixed(1)} of ${(load.totalMemoryBytes / GIB).toFixed(1)} GB free`
    : null
  const status =
    candidate.status === 'eligible'
      ? `score ${(candidate.score ?? 0).toFixed(2)}`
      : candidate.status === 'manual'
        ? 'manual only'
        : candidate.status === 'no-probe'
          ? 'no load probe (stock Orca or an older Blackfish)'
          : candidate.status === 'no-repo'
            ? 'repo not on this machine'
            : candidate.status === 'no-setup'
              ? 'project has no ready setup here (or its Blackfish is too old to say)'
              : 'unreachable'
  const preference = candidate.preference === 'less' ? 'less often' : candidate.preference
  return `${candidate.name} (${candidate.hostKey}, ${preference}): ${facts ? `${facts}, ` : ''}${status}`
}

/**
 * Whether a project selector (id, else a display name naming exactly one project) has a ready
 * setup on this machine itself, as `worktree create --project <p> --host runtime:<this id>` would
 * find when routed here. Setups this machine keeps for other hosts do not count.
 */
export function forkProjectReadyHere(
  projects: readonly Pick<Project, 'id' | 'displayName'>[],
  setups: readonly Pick<ProjectHostSetup, 'projectId' | 'hostId' | 'setupState'>[],
  selector: string
): boolean {
  let projectId: string | undefined
  if (projects.some((project) => project.id === selector)) {
    projectId = selector
  } else {
    const wanted = normalizeTypedName(selector)
    const named = projects.filter((project) => normalizeTypedName(project.displayName) === wanted)
    projectId = named.length === 1 ? named[0]?.id : undefined
  }
  const id = projectId ?? selector
  return setups.some(
    (setup) =>
      setup.projectId === id &&
      setup.setupState === 'ready' &&
      normalizeExecutionHostId(setup.hostId) === LOCAL_EXECUTION_HOST_ID
  )
}
