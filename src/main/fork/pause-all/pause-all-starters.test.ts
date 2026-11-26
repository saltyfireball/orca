// The Pause all starter table read against the code (BAD-818). It fails when a gate the table names
// is removed, when a gate call appears in a file the table does not name, and when a start primitive
// is called somewhere the table does not list, and when a row's starter is installed on the server
// (orcad) only from desktop code, or its install call is gone. What it cannot see: a new starter that starts work
// through a call that is not in PAUSE_ALL_START_PRIMITIVES (a new launch API, a direct PTY write, a
// spawned CLI), or one that reaches a listed primitive through a wrapper the table already lists, or
// a gate that is called but no longer guards the start (a call left on a dead branch).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAUSE_ALL_START_SITES } from './pause-all-start-sites'
import { PAUSE_ALL_GATE_FUNCTIONS, PAUSE_ALL_START_PRIMITIVES } from './pause-all-start-primitives'
import { PAUSE_ALL_STARTERS } from './pause-all-starters'

const ROOT = join(__dirname, '../../../..')
const PAUSE_ALL_DIR = 'src/main/fork/pause-all/'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'testing' || entry.name === 'node_modules' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.includes('test') ? [path] : []
  })
}

/** `text` with comments and string contents blanked (template `${}` parts kept), offsets kept. */
function codeOnly(text: string): string {
  let out = ''
  // Open template literals, each with the brace depth its current `${` started at.
  const templates: number[] = []
  let depth = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!
    const next = text[at + 1]
    if (templates.length > 0 && depth === templates.at(-1)) {
      // Inside a template literal's text.
      if (char === '\\') {
        out += '  '
        at += 1
      } else if (char === '`') {
        templates.pop()
        out += '`'
      } else if (char === '$' && next === '{') {
        depth += 1
        out += '${'
        at += 1
      } else {
        out += char === '\n' ? '\n' : ' '
      }
      continue
    }
    if (char === '/' && next === '/') {
      while (at < text.length && text[at] !== '\n') {
        out += ' '
        at += 1
      }
      out += at < text.length ? '\n' : ''
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', at + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(at, stop).replace(/[^\n]/g, ' ')
      at = stop - 1
    } else if (char === "'" || char === '"') {
      out += char
      at += 1
      while (at < text.length && text[at] !== char && text[at] !== '\n') {
        if (text[at] === '\\') {
          out += ' '
          at += 1
        }
        out += ' '
        at += 1
      }
      out += text[at] ?? ''
    } else if (char === '`') {
      out += '`'
      templates.push(depth)
    } else {
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      }
      out += char
    }
  }
  return out
}

/** Whether the call at `at` (its name's start) is a definition: `function name(`, `async name(`,
 *  or a method or type member, which starts its line and is followed by `{` or `:` after its
 *  parameters. */
function isDefinition(code: string, at: number, name: string): boolean {
  const lineStart = code.lastIndexOf('\n', at - 1) + 1
  const before = code.slice(lineStart, at)
  if (
    /function\s*\*?\s*$/.test(before) ||
    /^\s*(?:public\s+|private\s+|static\s+)*async\s+$/.test(before)
  ) {
    return true
  }
  if (before.trim() !== '') {
    return false
  }
  let depth = 0
  let close = at + name.length
  for (; close < code.length; close += 1) {
    if (code[close] === '(') {
      depth += 1
    } else if (code[close] === ')' && --depth === 0) {
      break
    }
  }
  const after = code.slice(close + 1).trimStart()
  return after.startsWith('{') || after.startsWith(':')
}

/** The callee of each call in `text`, as `name`, and as `object.name` when the object is a plain
 *  name. Comments, strings, imports and definitions never count. */
function callees(text: string): string[] {
  const code = codeOnly(text)
  const found: string[] = []
  for (const match of code.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1]!
    const at = match.index
    if (isDefinition(code, at, name)) {
      continue
    }
    found.push(name)
    const owner = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(
      code.slice(Math.max(0, at - 80), at)
    )
    if (owner) {
      found.push(`${owner[1]}.${name}`)
    }
  }
  return found
}

const NAMES: readonly string[] = [...PAUSE_ALL_GATE_FUNCTIONS, ...PAUSE_ALL_START_PRIMITIVES]

function countCalls(found: readonly string[], name: string): number {
  return found.filter((callee) => callee === name).length
}

function gateCalls(found: readonly string[]): number {
  return PAUSE_ALL_GATE_FUNCTIONS.reduce((sum, name) => sum + countCalls(found, name), 0)
}

const files = sourceFiles(join(ROOT, 'src/main')).flatMap((path) => {
  const text = readFileSync(path, 'utf8')
  // Parsed only where a name appears at all.
  const shortNames = NAMES.map((name) => name.split('.').at(-1)!)
  return shortNames.some((name) => text.includes(name))
    ? [{ file: relative(ROOT, path).split('\\').join('/'), text, found: callees(text) }]
    : []
})

const named = new Set(PAUSE_ALL_STARTERS.flatMap((row) => row.gates.map((gate) => gate.file)))

const ORCAD_START = 'src/main/backend/core-runtime-activation.ts'

/** Every file orcad loads from its start-up: relative static, dynamic and re-export imports. */
function orcadClosure(): Set<string> {
  const seen = new Set<string>()
  const queue = [ORCAD_START]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/g)) {
      const base = join(dirname(file), match[1]!)
      const found = [`${base}.ts`, join(base, 'index.ts'), base].find(
        (candidate) => candidate.endsWith('.ts') && existsSync(join(ROOT, candidate))
      )
      if (found) {
        queue.push(found.split('\\').join('/'))
      }
    }
  }
  return seen
}

/** Whether `file`'s code calls `name` (or spreads it, for a method table). */
function makesCall(text: string, name: string): boolean {
  return callees(text).includes(name) || codeOnly(text).includes(`...${name}`)
}

describe('Pause all starters', () => {
  it('lists each starter once, with a gate unless it is allowed', () => {
    const ids = PAUSE_ALL_STARTERS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of PAUSE_ALL_STARTERS) {
      expect(row.reason.length, row.id).toBeGreaterThan(0)
      expect(row.gates.length > 0, `${row.id}: ${row.answer} needs a gate, allowed has none`).toBe(
        row.answer !== 'allowed'
      )
    }
    for (const site of PAUSE_ALL_START_SITES) {
      expect(ids, `${site.file} names an unknown starter`).toContain(site.starter)
    }
  })

  it('finds every gate the table names, call for call', () => {
    const declared = new Map<string, number>()
    for (const gate of PAUSE_ALL_STARTERS.flatMap((row) => row.gates)) {
      declared.set(gate.file, (declared.get(gate.file) ?? 0) + gate.calls)
    }
    const found = new Map(
      files
        // The switch's own folder defines the gates; only the files the table names there count.
        .filter(({ file }) => !file.startsWith(PAUSE_ALL_DIR) || named.has(file))
        .map(({ file, found: calls }) => [file, gateCalls(calls)] as const)
        .filter(([, calls]) => calls > 0)
    )
    // A gate removed from a named file, or a gate added in a file the table does not name, shows here.
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(declared))
  })

  it('lists every call of a start primitive with the starter it belongs to', () => {
    const declared = new Map<string, number>()
    for (const site of PAUSE_ALL_START_SITES) {
      const key = `${site.file} ${site.primitive}`
      declared.set(key, (declared.get(key) ?? 0) + 1)
    }
    const found = new Map<string, number>()
    for (const { file, found: calls_ } of files) {
      for (const primitive of PAUSE_ALL_START_PRIMITIVES) {
        const calls = countCalls(calls_, primitive)
        if (calls > 0) {
          found.set(`${file} ${primitive}`, calls)
        }
      }
    }
    // A new unattended starter that calls one of these and is not listed shows here: add it to
    // PAUSE_ALL_STARTERS with its answer and its gate, and to PAUSE_ALL_START_SITES.
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(declared))
  })

  it('says for each gated row where orcad reaches it, from the files orcad loads', () => {
    const closure = orcadClosure()
    // A starter installed only by the desktop app is not reached here: naming it fails.
    expect(closure.has('src/main/fork/agent-queue/agent-queue-ipc.ts')).toBe(false)
    expect(closure.has('src/main/index.ts')).toBe(false)
    for (const row of PAUSE_ALL_STARTERS) {
      const reach = row.orcad
      expect(reach !== undefined, `${row.id}: a gated row says where orcad reaches it`).toBe(
        row.gates.length > 0
      )
      if (!reach) {
        continue
      }
      if ('notRun' in reach) {
        const callers = [...closure].filter((file) =>
          makesCall(readFileSync(join(ROOT, file), 'utf8'), reach.start)
        )
        expect(callers, `${row.id}: orcad starts ${reach.start}`).toEqual([])
        continue
      }
      expect(closure.has(reach.from), `${row.id}: orcad does not load ${reach.from}`).toBe(true)
      expect(
        makesCall(readFileSync(join(ROOT, reach.from), 'utf8'), reach.call),
        `${row.id}: ${reach.from} makes no ${reach.call} call`
      ).toBe(true)
      for (const gate of row.gates) {
        expect(closure.has(gate.file), `${row.id}: orcad does not load ${gate.file}`).toBe(true)
      }
    }
  })

  it('no longer finds the launch queue on orcad when its install line is taken out', () => {
    const file = 'src/main/fork/headless-host.ts'
    const text = readFileSync(join(ROOT, file), 'utf8')
    expect(makesCall(text, 'installForkAgentQueue')).toBe(true)
    const removed = text.replace(/\n\s*installForkAgentQueue\([^\n]*(?:\n[^\n]*?\))?/, '\n')
    expect(removed).not.toBe(text)
    expect(makesCall(removed, 'installForkAgentQueue')).toBe(false)
  })

  it('counts one gate fewer when a real gate is taken out', () => {
    const file = 'src/main/bots/bot-look-around-runner.ts'
    const text = files.find((entry) => entry.file === file)!.text
    const before = gateCalls(callees(text))
    expect(before).toBe(2)
    const removed = text.replace('forkPauseAllSkipsScheduledRun() !== null', 'false')
    expect(removed).not.toBe(text)
    expect(gateCalls(callees(removed))).toBe(before - 1)
    // Kept only in a comment, a string or an import, it no longer counts.
    const leftovers = [
      '// forkPauseAllSkipsScheduledRun()',
      "const note = 'isForkPauseAllEngaged()'",
      "import { isForkPauseAllEngaged } from 'x'"
    ].join('\n')
    expect(gateCalls(callees(leftovers))).toBe(0)
  })
})
