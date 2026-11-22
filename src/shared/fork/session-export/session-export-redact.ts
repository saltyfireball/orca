// Session export (FORK.md, BAD-688): redaction for exported conversations. It strips what a
// conversation commonly holds by accident: API keys and tokens by their shape, values of env-like
// names (KEY, TOKEN, SECRET, PASSWORD...), private key blocks, credentials in URLs, and the
// person's home folder. It is a safety net, not a guarantee: read an export before sharing it.
import type { SessionExportDocument } from './session-export'

export const SESSION_EXPORT_REDACTED = '[redacted]'

const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_.-]*`

// Each pattern keeps `$1` (the name or lead-in) and replaces the rest.
const ASSIGNMENT_PATTERNS: RegExp[] = [
  // Authorization: Bearer xxx, Basic xxx or a bare value, and a Bearer token on its own.
  /(\bauthorization["']?\s*[=:]\s*(?:(?:bearer|basic|token)\s+)?)[^\s"',;]+/gi,
  /(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  // NAME=value, NAME: value, "name": "value" with a secret-like name; a closing period is prose.
  new RegExp(
    String.raw`(\b${SECRET_NAME}["']?\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;&)]*[^\s"',;&).])`,
    'gi'
  ),
  // user:password@host in a URL.
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi
]

const WHOLE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
]

// Any user's home folder, so a path from another machine is covered too.
const HOME_PATTERNS: RegExp[] = [
  /\/Users\/[^/\s"'`:]+/g,
  /\/home\/[^/\s"'`:]+/g,
  /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`:]+/g
]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSessionExportText(text: string, homeDirs: readonly string[] = []): string {
  let out = text
  for (const pattern of WHOLE_PATTERNS) {
    out = out.replace(pattern, SESSION_EXPORT_REDACTED)
  }
  for (const pattern of ASSIGNMENT_PATTERNS) {
    out = out.replace(pattern, (_match, lead: string) => `${lead}${SESSION_EXPORT_REDACTED}`)
  }
  // Longest first, so a nested home folder is replaced whole.
  const homes = [...new Set(homeDirs.filter((dir) => dir.length > 1))].sort(
    (a, b) => b.length - a.length
  )
  for (const home of homes) {
    out = out.replace(
      new RegExp(`${escapeRegExp(home.replace(/[\\/]+$/, ''))}(?=[\\\\/]|$|\\W)`, 'g'),
      '~'
    )
  }
  for (const pattern of HOME_PATTERNS) {
    out = out.replace(pattern, '~')
  }
  return out
}

export function redactSessionExport(doc: SessionExportDocument): SessionExportDocument {
  return {
    ...doc,
    title: redactSessionExportText(doc.title, doc.homeDirs),
    entries: doc.entries.map((entry) => ({
      ...entry,
      text: redactSessionExportText(entry.text, doc.homeDirs)
    })),
    // The host's folders are named only so they can be removed; they never leave in a redacted export.
    homeDirs: []
  }
}
