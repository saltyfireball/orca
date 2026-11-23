#!/usr/bin/env node
// Blackfish is public: no owner-private names (bots, hosts, domains, user names) in tracked files.
// The list is private too, so it lives OUTSIDE the repo: one case-insensitive whole-word term per
// line (blank lines and # comments ignored) in the file named by BLACKFISH_PRIVATE_NAMES_FILE,
// default ~/.config/blackfish/private-names.txt. Without that file the check says so and passes, so
// a stranger's checkout is unaffected. Run: pnpm run check:private-names [paths...]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** The terms of a list file's text. */
export function parsePrivateNames(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/** Lines (path:line) of `files` (path -> text) that hold a term as a whole word. */
export function findPrivateNames(terms, files) {
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) {
    return []
  }
  const pattern = new RegExp(`(?<![A-Za-z0-9])(?:${escaped.join('|')})(?![A-Za-z0-9])`, 'i')
  const hits = []
  for (const [file, text] of Object.entries(files)) {
    text.split('\n').forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${file}:${index + 1}`)
      }
    })
  }
  return hits
}

function main() {
  const listPath =
    process.env.BLACKFISH_PRIVATE_NAMES_FILE ??
    path.join(homedir(), '.config', 'blackfish', 'private-names.txt')
  if (!existsSync(listPath)) {
    console.log(`private-names check skipped: no list at ${listPath}`)
    return 0
  }
  const terms = parsePrivateNames(readFileSync(listPath, 'utf8'))
  const args = process.argv.slice(2)
  const tracked = execFileSync('git', ['ls-files', '-z', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
    .split('\0')
    .filter((file) => file && !file.endsWith('pnpm-lock.yaml') && !file.includes('/i18n/locales/'))
  const files = {}
  for (const file of tracked) {
    try {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('\0')) {
        files[file] = text
      }
    } catch {
      // A path git lists but the tree no longer has.
    }
  }
  const hits = findPrivateNames(terms, files)
  // Only locations are printed, never the matched text, so a log never repeats a private term.
  for (const hit of hits) {
    console.error(hit)
  }
  console.log(hits.length === 0 ? 'private-names check OK' : `${hits.length} private-name hits`)
  return hits.length === 0 ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
