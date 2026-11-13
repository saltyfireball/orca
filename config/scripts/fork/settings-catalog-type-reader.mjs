// Fork settings catalog (FORK.md): reads every key of the `GlobalSettings` type with the
// TypeScript checker, so the catalog follows the type instead of a hand-kept list.
// The repo's TypeScript is the native compiler, whose checker is reached through its
// `unstable/sync` API; all use of that API stays in this file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { API, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

/** How deep a nested value is described; deeper values are accepted as they are. */
const MAX_DEPTH = 4
/** A key set this large is described as a record instead of one field per key. */
const MAX_FIELDS = 40

const SETTINGS_FILE = path.join('src', 'shared', 'global-settings-types.ts')

function toAscii(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u2026/g, '...')
    .replace(/\u00a5/g, 'yen')
    .replace(/[^\x20-\x7E\s]/g, '')
}

/** One plain line from a doc comment: no "Why:" lead, no card keys, no line breaks. */
export function plainDescription(doc) {
  return toAscii(doc)
    .replace(/\s+/g, ' ')
    .replace(/^\s*(Why|Fork)\s*:\s*/i, '')
    .replace(/^Fork \([A-Z]+-\d+\):\s*/, '')
    .replace(/^Fork\s+/, '')
    .replace(/\s*\(#\d+(\/#\d+)*\)/g, '')
    .trim()
    .replace(/^./, (first) => first.toUpperCase())
}

function literalValue(type) {
  if (type.flags & TypeFlags.BooleanLiteral) {
    return type.value === true || type.intrinsicName === 'true'
  }
  return type.value
}

function isLiteral(type) {
  return Boolean(
    type.flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral)
  )
}

function unionShape(checker, type, depth) {
  let nullable = false
  const literals = []
  const others = []
  for (const member of type.getTypes() ?? []) {
    if (member.flags & TypeFlags.Null) {
      nullable = true
    } else if (member.flags & TypeFlags.Undefined) {
      continue
    } else if (isLiteral(member)) {
      literals.push(literalValue(member))
    } else {
      others.push(member)
    }
  }
  const shapes = others.map((member) => shapeOf(checker, member, depth))
  const hasTrue = literals.includes(true)
  const hasFalse = literals.includes(false)
  const rest = literals.filter((value) => typeof value !== 'boolean')
  if (hasTrue && hasFalse) {
    shapes.push({ k: 'boolean' })
  } else if (hasTrue || hasFalse) {
    rest.push(hasTrue)
  }
  if (rest.length > 0) {
    // A string that also lists suggestions (`'a' | (string & {})`) is just a string.
    if (!shapes.some((shape) => shape.k === 'string' && rest.every((v) => typeof v === 'string'))) {
      shapes.push({ k: 'enum', values: rest })
    }
  }
  const unique = [...new Map(shapes.map((shape) => [JSON.stringify(shape), shape])).values()]
  const shape = unique.length === 1 ? unique[0] : { k: 'union', of: unique }
  return nullable ? { ...shape, nullable: true } : shape
}

function objectShape(checker, type, depth) {
  if (depth >= MAX_DEPTH) {
    return { k: 'unknown' }
  }
  const index = checker
    .getIndexInfosOfType(type)
    .find((info) => info.keyType.flags & TypeFlags.StringLike)?.valueType
  const properties = checker.getPropertiesOfType(type)
  if (index && properties.length === 0) {
    return { k: 'record', of: shapeOf(checker, index, depth + 1) }
  }
  if (properties.length === 0) {
    return { k: 'unknown' }
  }
  const fields = {}
  for (const property of properties) {
    const optional = Boolean(property.flags & SymbolFlags.Optional)
    const shape = shapeOf(checker, checker.getTypeOfSymbol(property), depth + 1)
    fields[property.name] = optional ? { ...shape, optional: true } : shape
  }
  const shapes = Object.values(fields)
  const same = new Set(shapes.map((shape) => JSON.stringify(shape))).size === 1
  if (properties.length > MAX_FIELDS || (same && properties.length > 6 && shapes[0].optional)) {
    // `Partial<Record<Agent, T>>`: name the keys once instead of repeating T per agent.
    if (same) {
      const { optional: _optional, ...of } = shapes[0]
      return { k: 'record', of, keys: Object.keys(fields) }
    }
    return { k: 'unknown' }
  }
  return { k: 'object', fields }
}

/** A small, checkable description of a settings value type. */
export function shapeOf(checker, type, depth = 0) {
  if (type.flags & TypeFlags.Boolean) {
    return { k: 'boolean' }
  }
  if (type.isUnionType()) {
    return unionShape(checker, type, depth)
  }
  if (isLiteral(type)) {
    return { k: 'enum', values: [literalValue(type)] }
  }
  if (type.flags & TypeFlags.StringLike) {
    return { k: 'string' }
  }
  if (type.flags & TypeFlags.NumberLike) {
    return { k: 'number' }
  }
  if (type.flags & TypeFlags.Null) {
    return { k: 'unknown', nullable: true }
  }
  if (type.isIntersectionType()) {
    // Branded strings (`string & {}`) stay strings; object intersections merge their fields.
    if ((type.getTypes() ?? []).some((member) => member.flags & TypeFlags.StringLike)) {
      return { k: 'string' }
    }
    return objectShape(checker, type, depth)
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [item] = checker.getTypeArguments(type)
    return { k: 'array', of: item ? shapeOf(checker, item, depth + 1) : { k: 'unknown' } }
  }
  if (type.flags & TypeFlags.Object) {
    return objectShape(checker, type, depth)
  }
  return { k: 'unknown' }
}

function declaringFile(repoRoot, symbol) {
  const file = symbol.declarations[0]?.path
  if (!file) {
    return ''
  }
  // The compiler lower-cases paths on case-insensitive disks; compare the same way.
  const root = repoRoot.toLowerCase().split(path.sep).join('/')
  const lower = String(file).toLowerCase()
  return lower.startsWith(`${root}/`) ? String(file).slice(root.length + 1) : String(file)
}

/**
 * Every key of `GlobalSettings`, in name order: its value shape, doc comment and the file
 * that declares it.
 */
export function readSettingsKeys(repoRoot) {
  // A one-file project under the ignored out/ folder keeps the compiler off the whole app.
  const outRoot = path.join(repoRoot, 'out')
  mkdirSync(outRoot, { recursive: true })
  const scratch = mkdtempSync(path.join(outRoot, 'fork-settings-catalog-'))
  const config = path.join(scratch, 'tsconfig.json')
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: 'esnext',
        module: 'esnext',
        moduleResolution: 'bundler',
        types: []
      },
      files: [path.join(repoRoot, SETTINGS_FILE)]
    })
  )
  const api = new API({ cwd: repoRoot })
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config) ?? snapshot.getProjects()[0]
    if (!project) {
      throw new Error('The TypeScript API opened no project for the settings type.')
    }
    const { checker } = project
    const alias = checker.resolveName('GlobalSettings', SymbolFlags.TypeAlias, {
      document: path.join(repoRoot, SETTINGS_FILE),
      position: 0
    })
    if (!alias) {
      throw new Error(`No GlobalSettings type in ${SETTINGS_FILE}`)
    }
    const settings = checker.getDeclaredTypeOfSymbol(alias)
    return checker
      .getPropertiesOfType(settings)
      .map((property) => ({
        key: property.name,
        optional: Boolean(property.flags & SymbolFlags.Optional),
        shape: shapeOf(checker, checker.getTypeOfSymbol(property)),
        doc: plainDescription(property.getDocumentationComment(checker)),
        file: declaringFile(repoRoot, property)
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  } finally {
    api.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}
