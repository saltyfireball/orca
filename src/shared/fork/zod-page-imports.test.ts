// BAD-681: the mobile web bundle fails when a file the page reaches has `import { z } from 'zod'`
// (63 locale tables reach the page). This follows the relative imports from mobile/src and fails
// on such a file under src/shared/fork (upstream files do it and build, so only the fork's are held to it), before a release build does.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm
const NAMED_Z = /^\s*import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*['"]zod['"]/m

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') {
        walk(path, out)
      }
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.test-fixture\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

describe('files the mobile page reaches', () => {
  it('do not import { z } from zod', () => {
    const seen = new Set<string>()
    const queue = walk(join(ROOT, 'mobile/src'), [])
    const offenders: string[] = []
    while (queue.length > 0) {
      const file = queue.pop() as string
      if (seen.has(file)) {
        continue
      }
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      if (file.startsWith(join(ROOT, 'src/shared/fork')) && NAMED_Z.test(text)) {
        offenders.push(file.slice(ROOT.length + 1))
      }
      for (const match of text.matchAll(IMPORT)) {
        const next = resolveImport(file, match[1] ?? match[2])
        if (next && !seen.has(next)) {
          queue.push(next)
        }
      }
    }
    expect(seen.size).toBeGreaterThan(100)
    expect(offenders).toEqual([])
  })
})
