// Server memory protection (SLRM-2384, FORK.md): the steps that need root, printed for the user and
// never run. Memory protection only reaches the server when every slice above it holds at least as
// much, and the server is only reachable while tailscaled and sshd survive; both are system units.
import type { ServeProtectValues } from '../../shared/fork/serve-protect'

export type ServeProtectSystemFacts = {
  uid: number
  /** The system units that exist here, with their values as `systemctl show` reports them. */
  units: { unit: string; memoryMin: string; memoryLow: string; oomScoreAdjust: string }[]
}

const UNITS: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

/** Bytes of a systemd size (`256M`) or a `systemctl show` value (bytes, `infinity`); else 0. */
export function serveProtectBytes(value: string | null): number {
  if (!value) {
    return 0
  }
  if (value === 'infinity') {
    return Number.POSITIVE_INFINITY
  }
  const match = /^(\d+)([KMGT]?)$/i.exec(value.trim())
  return match ? Number(match[1]) * UNITS[match[2].toUpperCase()] : 0
}

function memorySteps(facts: ServeProtectSystemFacts, values: ServeProtectValues): string[] {
  const wantMin = serveProtectBytes(values.memoryMin)
  const wantLow = serveProtectBytes(values.memoryLow)
  if (wantMin === 0 && wantLow === 0) {
    return []
  }
  const steps: string[] = []
  for (const unit of ['user.slice', `user-${facts.uid}.slice`, `user@${facts.uid}.service`]) {
    const fact = facts.units.find((entry) => entry.unit === unit)
    if (!fact) {
      continue
    }
    const assignments = [
      ...(serveProtectBytes(fact.memoryMin) < wantMin ? [`MemoryMin=${values.memoryMin}`] : []),
      ...(serveProtectBytes(fact.memoryLow) < wantLow ? [`MemoryLow=${values.memoryLow}`] : [])
    ]
    if (assignments.length > 0) {
      steps.push(`sudo systemctl set-property ${unit} ${assignments.join(' ')}`)
    }
  }
  return steps
}

function oomSteps(facts: ServeProtectSystemFacts, score: number): string[] {
  const steps: string[] = []
  for (const fact of facts.units) {
    if (!['tailscaled.service', 'ssh.service', 'sshd.service'].includes(fact.unit)) {
      continue
    }
    const current = Number(fact.oomScoreAdjust)
    if (Number.isInteger(current) && current <= score) {
      continue
    }
    const dir = `/etc/systemd/system/${fact.unit}.d`
    const name = fact.unit.slice(0, -'.service'.length)
    steps.push(
      `sudo mkdir -p ${dir} && printf '[Service]\\nOOMScoreAdjust=${score}\\n' | sudo tee ${dir}/50-blackfish-protect.conf >/dev/null && sudo systemctl daemon-reload`,
      `pid=$(systemctl show -p MainPID --value ${name}) && [ "$pid" != 0 ] && echo ${score} | sudo tee /proc/$pid/oom_score_adj >/dev/null`
    )
  }
  return steps
}

/** The root steps still needed, in order; empty when the system already protects enough. */
export function serveProtectRootSteps(
  facts: ServeProtectSystemFacts,
  values: ServeProtectValues,
  systemOomScore: number
): string[] {
  return [...memorySteps(facts, values), ...oomSteps(facts, systemOomScore)]
}
