// Endpoint failover (SLRM-2267, FORK.md): the addresses each saved server last reported, kept in
// the app's data folder so a restart away from the server's LAN still knows its Tailscale address.
// Each entry is tied to the server's host key: a re-pair to another server drops what was learned.
// Only addresses and the public host key are stored, never a token. An unreadable file reads as
// empty rather than failing start-up.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { normalizeForkLearnedAddresses } from '../../../shared/fork/endpoint-failover'
import type { LearnedRoutes } from './endpoint-failover-supervisor'

export const ENDPOINT_ROUTES_FILE_NAME = 'fork-endpoint-routes.json'

type RoutesEntry = LearnedRoutes & { hostKey: string }

type RoutesFile = { version: 1; servers: Record<string, RoutesEntry> }

function parseRoutesFile(text: string): Map<string, RoutesEntry> {
  const result = new Map<string, RoutesEntry>()
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('servers' in parsed)) {
    return result
  }
  const servers = parsed.servers
  if (typeof servers !== 'object' || servers === null) {
    return result
  }
  for (const [id, value] of Object.entries(servers)) {
    if (typeof value !== 'object' || value === null) {
      continue
    }
    const hostKey = 'hostKey' in value ? value.hostKey : undefined
    const learnedAt = 'learnedAt' in value ? value.learnedAt : undefined
    if (typeof hostKey !== 'string' || typeof learnedAt !== 'number') {
      continue
    }
    const addresses = normalizeForkLearnedAddresses('addresses' in value ? value.addresses : [])
    result.set(id, { hostKey, learnedAt, addresses })
  }
  return result
}

export class EndpointRoutesFile {
  private entries: Map<string, RoutesEntry> | null = null
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, ENDPOINT_ROUTES_FILE_NAME)
  }

  read(environmentId: string, hostKey: string): LearnedRoutes | null {
    const entry = this.load().get(environmentId)
    if (!entry || entry.hostKey !== hostKey) {
      return null
    }
    return { addresses: entry.addresses, learnedAt: entry.learnedAt }
  }

  write(environmentId: string, hostKey: string, routes: LearnedRoutes): void {
    const entries = this.load()
    const previous = entries.get(environmentId)
    const unchanged =
      previous?.hostKey === hostKey &&
      JSON.stringify(previous.addresses) === JSON.stringify(routes.addresses)
    entries.set(environmentId, { hostKey, ...routes })
    // The learn time alone is not worth a disk write; it is only kept for the record.
    if (unchanged) {
      return
    }
    this.save(entries)
  }

  /** Drops entries of servers no longer saved. */
  retain(environmentIds: ReadonlySet<string>): void {
    const entries = this.load()
    let changed = false
    for (const id of entries.keys()) {
      if (!environmentIds.has(id)) {
        entries.delete(id)
        changed = true
      }
    }
    if (changed) {
      this.save(entries)
    }
  }

  private load(): Map<string, RoutesEntry> {
    if (this.entries) {
      return this.entries
    }
    let entries = new Map<string, RoutesEntry>()
    if (existsSync(this.path)) {
      try {
        entries = parseRoutesFile(readFileSync(this.path, 'utf8'))
      } catch (error) {
        console.warn(
          '[fork-endpoint-failover] Could not read the learned routes; starting empty:',
          error
        )
      }
    }
    this.entries = entries
    return entries
  }

  private save(entries: Map<string, RoutesEntry>): void {
    const file: RoutesFile = { version: 1, servers: Object.fromEntries(entries) }
    try {
      writeFileAtomically(this.path, JSON.stringify(file), { mode: 0o600 })
    } catch (error) {
      console.warn('[fork-endpoint-failover] Could not save the learned routes:', error)
    }
  }
}
