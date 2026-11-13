// Settings from the CLI (FORK.md): the checkable description of one settings value, written
// by the catalog generator from the `GlobalSettings` type.

type ShapeFlags = { nullable?: boolean; optional?: boolean }

export type ForkSettingShape = ShapeFlags &
  (
    | { k: 'boolean' | 'number' | 'string' | 'unknown' }
    | { k: 'enum'; values: (string | number | boolean)[] }
    | { k: 'array'; of: ForkSettingShape }
    | { k: 'record'; of: ForkSettingShape; keys?: string[] }
    | { k: 'object'; fields: Record<string, ForkSettingShape> }
    | { k: 'union'; of: ForkSettingShape[] }
  )

/** A type line longer than this names the kind of value only. */
const TYPE_TEXT_MAX = 72

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fullTypeText(shape: ForkSettingShape): string {
  const text = ((): string => {
    switch (shape.k) {
      case 'enum':
        return shape.values.map((value) => JSON.stringify(value)).join(' | ')
      case 'array': {
        const item = fullTypeText(shape.of)
        return item.includes(' | ') ? `(${item})[]` : `${item}[]`
      }
      case 'record':
        return `{ [name]: ${fullTypeText(shape.of)} }`
      case 'object':
        return `{ ${Object.entries(shape.fields)
          .map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${fullTypeText(field)}`)
          .join(', ')} }`
      case 'union':
        return shape.of.map(fullTypeText).join(' | ')
      case 'unknown':
        return 'any'
      default:
        return shape.k
    }
  })()
  return shape.nullable ? `${text} | null` : text
}

function kindText(shape: ForkSettingShape): string {
  const kind =
    shape.k === 'array'
      ? 'list'
      : shape.k === 'record' || shape.k === 'object'
        ? 'object'
        : shape.k === 'union'
          ? [...new Set(shape.of.map(kindText))].join(' | ')
          : shape.k === 'enum'
            ? 'one of a fixed set'
            : fullTypeText({ ...shape, nullable: false })
  return shape.nullable ? `${kind} | null` : kind
}

/** The type as one line a person can read: `number`, `"a" | "b"`, `string[]`, `object`. */
export function describeForkSettingShape(shape: ForkSettingShape): string {
  const full = fullTypeText(shape)
  return full.length <= TYPE_TEXT_MAX ? full : kindText(shape)
}

function at(path: string, message: string): string {
  return path ? `${path}: ${message}` : message
}

/**
 * Why `value` does not fit `shape`, or null when it does. `path` names the place inside the
 * setting (`servers[2].name`), empty for the setting itself.
 */
export function checkForkSettingValue(
  shape: ForkSettingShape,
  value: unknown,
  path = ''
): string | null {
  if (value === null) {
    return shape.nullable || shape.k === 'unknown' ? null : at(path, 'null is not allowed')
  }
  switch (shape.k) {
    case 'unknown':
      return null
    case 'boolean':
    case 'string':
      return typeof value === shape.k ? null : at(path, `expected ${shape.k}`)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : at(path, 'expected number')
    case 'enum':
      return shape.values.includes(value as string | number | boolean)
        ? null
        : at(path, `expected one of ${shape.values.map((v) => JSON.stringify(v)).join(', ')}`)
    case 'array': {
      if (!Array.isArray(value)) {
        return at(path, 'expected a list')
      }
      for (const [index, item] of value.entries()) {
        const problem = checkForkSettingValue(shape.of, item, `${path}[${index}]`)
        if (problem) {
          return problem
        }
      }
      return null
    }
    case 'record': {
      if (!isPlainObject(value)) {
        return at(path, 'expected an object')
      }
      for (const [name, item] of Object.entries(value)) {
        if (shape.keys && !shape.keys.includes(name)) {
          return at(path, `unknown name "${name}"; expected one of ${shape.keys.join(', ')}`)
        }
        const problem = checkForkSettingValue(shape.of, item, path ? `${path}.${name}` : name)
        if (problem) {
          return problem
        }
      }
      return null
    }
    case 'object': {
      if (!isPlainObject(value)) {
        return at(path, 'expected an object')
      }
      for (const name of Object.keys(value)) {
        if (!Object.hasOwn(shape.fields, name)) {
          return at(path, `unknown field "${name}"`)
        }
      }
      for (const [name, field] of Object.entries(shape.fields)) {
        const child = path ? `${path}.${name}` : name
        if (value[name] === undefined) {
          if (!field.optional) {
            return at(child, 'is required')
          }
          continue
        }
        const problem = checkForkSettingValue(field, value[name], child)
        if (problem) {
          return problem
        }
      }
      return null
    }
    case 'union': {
      const problems = shape.of.map((member) => checkForkSettingValue(member, value, path))
      return problems.includes(null)
        ? null
        : // One member: its own message says more than the list of alternatives.
          (problems.length === 1 && problems[0]) ||
            at(path, `expected ${describeForkSettingShape(shape)}`)
    }
  }
}

/** Structural equality of two JSON values; an absent object field equals `undefined`. */
export function forkSettingValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => forkSettingValuesEqual(item, b[index]))
    )
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false
  }
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...names].every((name) => forkSettingValuesEqual(a[name], b[name]))
}
