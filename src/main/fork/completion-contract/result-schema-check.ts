// Result schema (BAD-816, FORK.md): the coordinator's JSON Schema and the worker's value, checked
// with ajv (already in the tree). The schema is walked before ajv sees it: only local `$ref`s, no
// `$id`, no recursion, no regex or format keywords, and caps on size, depth and expanded size, so a
// check's time is bounded by the schema and value caps. An unsupported schema is refused at create.
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import {
  FORK_RESULT_SCHEMA_MAX_BYTES,
  FORK_RESULT_VALUE_MAX_BYTES,
  isJsonRecord,
  registerForkResultSchemaCheck,
  utf8Bytes
} from '../../../shared/fork/result-schema'

const MAX_SCHEMA_DEPTH = 32
/** Schema nodes after every `$ref` is followed: a check visits at most this many per value node. */
const MAX_EXPANDED_NODES = 2000
const MAX_VALUE_DEPTH = 64
const MAX_ERRORS_SHOWN = 10
/** A check past this is reported as failed; the caps above keep real ones far below it. */
const CHECK_BUDGET_MS = 1000
const DRAFT_07 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/u

const SUBSCHEMA_KEYS = new Set([
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else'
])
const SUBSCHEMA_LIST_KEYS = new Set(['allOf', 'anyOf', 'oneOf'])
const SUBSCHEMA_MAP_KEYS = new Set(['properties', '$defs', 'definitions'])
const VALUE_KEYS = new Set([
  '$schema',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'type',
  'enum',
  'const',
  'required',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  '$ref'
])
const WHY_UNSUPPORTED: Record<string, string> = {
  pattern: 'regular expressions are not run on worker output',
  patternProperties: 'regular expressions are not run on worker output',
  format: 'formats are not checked',
  $id: 'a schema here cannot name or fetch other schemas',
  uniqueItems: 'its cost grows with the square of the array',
  dependencies: 'not supported',
  $data: 'not supported'
}

/** A parsed schema that passed the walk: a JSON object. */
type ResultSchemaObject = Record<string, unknown>

export type SchemaCheck = { ok: true; schema: ResultSchemaObject } | { ok: false; error: string }
export type ValueCheck = { ok: true; canonical: string } | { ok: false; error: string }

class Refused extends Error {}

/** RFC 6901 pointer inside the root, `#` or `#/a/b`. */
function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) {
    throw new Refused(`$ref ${JSON.stringify(ref)} is not a local reference (#/...)`)
  }
  let node = root
  for (const raw of ref.slice(1).split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (!isJsonRecord(node) || !(key in node)) {
      throw new Refused(`$ref ${JSON.stringify(ref)} points at nothing in this schema`)
    }
    node = node[key]
  }
  return node
}

/** Walks every keyword, following `$ref`s, and counts the expanded size. */
function walk(root: unknown): void {
  let expanded = 0
  const visit = (node: unknown, at: string, depth: number, refs: string[]): void => {
    expanded += 1
    if (expanded > MAX_EXPANDED_NODES) {
      throw new Refused(`it expands to more than ${MAX_EXPANDED_NODES} schema nodes`)
    }
    if (depth > MAX_SCHEMA_DEPTH) {
      throw new Refused(`it nests deeper than ${MAX_SCHEMA_DEPTH} levels`)
    }
    if (typeof node === 'boolean') {
      return
    }
    if (!isJsonRecord(node)) {
      throw new Refused(`${at} is not a schema (an object or true/false)`)
    }
    for (const [key, value] of Object.entries(node)) {
      const here = `${at}/${key}`
      if (key in WHY_UNSUPPORTED) {
        throw new Refused(`${here}: ${key} is not supported (${WHY_UNSUPPORTED[key]})`)
      }
      if (key === '$schema' && (typeof value !== 'string' || !DRAFT_07.test(value))) {
        throw new Refused(`${here}: only draft-07 is supported (or leave $schema out)`)
      }
      if (key === '$ref') {
        if (typeof value !== 'string') {
          throw new Refused(`${here} is not a string`)
        }
        if (refs.includes(value)) {
          throw new Refused(`${here}: recursive schemas are not supported`)
        }
        visit(resolvePointer(root, value), here, depth + 1, [...refs, value])
      } else if (SUBSCHEMA_KEYS.has(key)) {
        visit(value, here, depth + 1, refs)
      } else if (key === 'items') {
        const list = Array.isArray(value) ? value : [value]
        list.forEach((entry, index) => visit(entry, `${here}/${index}`, depth + 1, refs))
      } else if (SUBSCHEMA_LIST_KEYS.has(key)) {
        if (!Array.isArray(value) || value.length === 0) {
          throw new Refused(`${here} must be a non-empty array of schemas`)
        }
        value.forEach((entry, index) => visit(entry, `${here}/${index}`, depth + 1, refs))
      } else if (SUBSCHEMA_MAP_KEYS.has(key)) {
        if (!isJsonRecord(value)) {
          throw new Refused(`${here} must be an object of schemas`)
        }
        for (const [name, entry] of Object.entries(value)) {
          visit(entry, `${here}/${name}`, depth + 1, refs)
        }
      } else if (!VALUE_KEYS.has(key)) {
        throw new Refused(`${here}: ${key} is not a supported keyword`)
      }
    }
  }
  visit(root, '#', 0, [])
}

function newAjv(): Ajv {
  // No loadSchema: an unresolved reference fails the compile instead of fetching anything.
  return new Ajv({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    $data: false,
    ownProperties: true,
    validateFormats: false,
    logger: false,
    messages: true
  })
}

const compiled = new Map<string, ValidateFunction>()
const COMPILED_KEEP = 32

function compile(text: string, schema: ResultSchemaObject): ValidateFunction {
  const cached = compiled.get(text)
  if (cached) {
    return cached
  }
  const validate = newAjv().compile(schema)
  const oldest = compiled.keys().next()
  if (compiled.size >= COMPILED_KEEP && !oldest.done) {
    compiled.delete(oldest.value)
  }
  compiled.set(text, validate)
  return validate
}

/** The coordinator's schema: refused with the reason when it is invalid or unsupported. */
export function checkResultSchema(text: string): SchemaCheck {
  if (utf8Bytes(text) > FORK_RESULT_SCHEMA_MAX_BYTES) {
    return { ok: false, error: `it is larger than ${FORK_RESULT_SCHEMA_MAX_BYTES} bytes` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `it is not JSON (${messageOf(error)})` }
  }
  if (!isJsonRecord(parsed)) {
    return { ok: false, error: 'it must be a JSON object' }
  }
  try {
    walk(parsed)
    compile(text, parsed)
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
  return { ok: true, schema: parsed }
}

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_VALUE_DEPTH || typeof value !== 'object' || value === null) {
    return depth
  }
  let deepest = depth
  for (const entry of Object.values(value)) {
    deepest = Math.max(deepest, depthOf(entry, depth + 1))
    if (deepest > MAX_VALUE_DEPTH) {
      break
    }
  }
  return deepest
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorLine(error: ErrorObject): string {
  const extra =
    error.keyword === 'additionalProperties' && 'additionalProperty' in error.params
      ? ` (${JSON.stringify(error.params.additionalProperty)})`
      : ''
  return `- ${error.instancePath || '/'}: ${error.message ?? error.keyword}${extra}`
}

registerForkResultSchemaCheck((schema) => {
  const checked = checkResultSchema(schema)
  return checked.ok ? null : checked.error
})

/** The worker's value against a schema already accepted by checkResultSchema. */
export function checkResultValue(schemaText: string, valueText: string): ValueCheck {
  if (utf8Bytes(valueText) > FORK_RESULT_VALUE_MAX_BYTES) {
    return { ok: false, error: `The result is larger than ${FORK_RESULT_VALUE_MAX_BYTES} bytes.` }
  }
  let value: unknown
  try {
    value = JSON.parse(valueText)
  } catch (error) {
    return { ok: false, error: `The result is not JSON (${messageOf(error)}).` }
  }
  if (depthOf(value) > MAX_VALUE_DEPTH) {
    return { ok: false, error: `The result nests deeper than ${MAX_VALUE_DEPTH} levels.` }
  }
  const schema = checkResultSchema(schemaText)
  if (!schema.ok) {
    return { ok: false, error: `The Task's result schema cannot be used: ${schema.error}.` }
  }
  const validate = compile(schemaText, schema.schema)
  const started = performance.now()
  const valid = validate(value)
  if (performance.now() - started > CHECK_BUDGET_MS) {
    return { ok: false, error: `Checking the result took longer than ${CHECK_BUDGET_MS} ms.` }
  }
  if (!valid) {
    const errors = validate.errors ?? []
    const lines = errors.slice(0, MAX_ERRORS_SHOWN).map(errorLine)
    if (errors.length > MAX_ERRORS_SHOWN) {
      lines.push(`- and ${errors.length - MAX_ERRORS_SHOWN} more`)
    }
    return { ok: false, error: `The result does not match the schema:\n${lines.join('\n')}` }
  }
  return { ok: true, canonical: JSON.stringify(value) }
}
