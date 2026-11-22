import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  formatCountBaseline,
  listTrackedFiles,
  runCountRatchet
} from '../../ratchet-baseline/ratchet-baseline.mjs'

// Ratchet on the bytes of text Orca injects into every agent it launches. Each byte is paid by
// every worker on every turn, so the total may not grow past the baseline unless the baseline
// is raised on purpose (`pnpm check:injected-context-ratchet --update`, reviewed in the diff).
//
// Artifacts (one baseline row each, value = bytes):
//   - skill-guides/*.md and skills/*/SKILL.md: the bundled guides and their installed stubs
//   - skill-guides/<name>/references/*: reference files bundled with a guide
//   - the worker dispatch preamble source (its template text is sent with every dispatch)
// MCP profile tool lists come from user configuration, so they are not measured here.

const BASELINE_PATH = 'config/injected-context-baseline.txt'
const PREAMBLE_SOURCE = 'src/main/runtime/orchestration/workers/launch/worker-dispatch-preamble.ts'
const PATHSPECS = ['skill-guides', 'skills', PREAMBLE_SOURCE]
const HEADER = [
  '# Bytes of text Orca injects into every launched agent: bundled skill guides, installed skill',
  '# stubs, and the worker dispatch preamble. Each byte is paid by every worker on every turn.',
  '# This is a RATCHET: raise a row only on purpose, with `pnpm check:injected-context-ratchet --update`.',
  '# Format: <bytes> <path>'
]

export function collectInjectedContextSizes(root = process.cwd()) {
  const sizes = new Map()
  for (const rel of listTrackedFiles(root, PATHSPECS)) {
    if (!rel.endsWith('.md') && rel !== PREAMBLE_SOURCE) {
      continue
    }
    try {
      sizes.set(rel, fs.statSync(path.join(root, rel)).size)
    } catch {
      // Deleted in the working tree but still tracked.
    }
  }
  return sizes
}

export function main(root = process.cwd(), arg = undefined) {
  const current = collectInjectedContextSizes(root)
  const total = [...current.values()].reduce((sum, size) => sum + size, 0)
  if (arg === '--update') {
    fs.writeFileSync(path.join(root, BASELINE_PATH), formatCountBaseline(current, HEADER))
    console.log(`Wrote ${BASELINE_PATH}: ${current.size} artifacts, ${total} bytes.`)
    return 0
  }
  for (const [rel, size] of [...current].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`${String(size).padStart(8)}  ${rel}`)
  }
  console.log(`${String(total).padStart(8)}  TOTAL (${current.size} artifacts)`)
  return runCountRatchet(
    {
      name: 'injected-context',
      unit: 'bytes',
      baselinePath: BASELINE_PATH,
      header: HEADER,
      collect: () => current,
      fix: [
        'This file is injected into every agent Orca launches, so its size is paid by every',
        'worker on every turn. Trim it. If the growth is worth it, raise the baseline on purpose:',
        '  pnpm check:injected-context-ratchet --update'
      ]
    },
    root,
    arg
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.cwd(), process.argv[2]))
}
