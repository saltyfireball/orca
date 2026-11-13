// Settings from the CLI (FORK.md): checking a value against a setting's type.
import { describe, expect, it } from 'vitest'
import {
  checkForkSettingValue,
  describeForkSettingShape,
  forkSettingValuesEqual,
  type ForkSettingShape
} from './settings-shape'

const server: ForkSettingShape = {
  k: 'object',
  fields: {
    name: { k: 'string' },
    mode: { k: 'enum', values: ['allow', 'deny'] },
    port: { k: 'number', optional: true },
    extra: { k: 'unknown', optional: true }
  }
}

describe('checkForkSettingValue', () => {
  it('accepts values of the right type', () => {
    expect(checkForkSettingValue({ k: 'boolean' }, true)).toBeNull()
    expect(checkForkSettingValue({ k: 'number' }, 14)).toBeNull()
    expect(checkForkSettingValue({ k: 'string', nullable: true }, null)).toBeNull()
    expect(
      checkForkSettingValue({ k: 'array', of: server }, [{ name: 'a', mode: 'deny' }])
    ).toBeNull()
    expect(checkForkSettingValue({ k: 'record', of: { k: 'boolean' } }, { a: true })).toBeNull()
    expect(checkForkSettingValue({ k: 'unknown' }, { any: ['thing'] })).toBeNull()
  })

  it('names what is wrong and where', () => {
    expect(checkForkSettingValue({ k: 'boolean' }, 'yes')).toBe('expected boolean')
    expect(checkForkSettingValue({ k: 'number' }, '14')).toBe('expected number')
    expect(checkForkSettingValue({ k: 'number' }, Number.NaN)).toBe('expected number')
    expect(checkForkSettingValue({ k: 'string' }, null)).toBe('null is not allowed')
    expect(checkForkSettingValue({ k: 'enum', values: ['a', 'b'] }, 'c')).toBe(
      'expected one of "a", "b"'
    )
    expect(checkForkSettingValue({ k: 'array', of: server }, [{ name: 'a', mode: 'x' }])).toBe(
      '[0].mode: expected one of "allow", "deny"'
    )
    expect(checkForkSettingValue(server, { name: 'a' })).toBe('mode: is required')
    expect(checkForkSettingValue(server, { name: 'a', mode: 'allow', nope: 1 })).toBe(
      'unknown field "nope"'
    )
    expect(checkForkSettingValue({ k: 'record', of: { k: 'boolean' } }, { a: 1 })).toBe(
      'a: expected boolean'
    )
    expect(
      checkForkSettingValue({ k: 'record', of: { k: 'boolean' }, keys: ['x'] }, { y: true })
    ).toBe('unknown name "y"; expected one of x')
    expect(checkForkSettingValue({ k: 'array', of: { k: 'string' } }, 'a')).toBe('expected a list')
  })

  it('accepts a union member and reports the union otherwise', () => {
    const shape: ForkSettingShape = { k: 'union', of: [{ k: 'string' }, { k: 'number' }] }
    expect(checkForkSettingValue(shape, 3)).toBeNull()
    expect(checkForkSettingValue(shape, true)).toBe('expected string | number')
  })
})

describe('describeForkSettingShape', () => {
  it('prints short types in full and long ones by kind', () => {
    expect(describeForkSettingShape({ k: 'number' })).toBe('number')
    expect(describeForkSettingShape({ k: 'enum', values: ['a', 'b'], nullable: true })).toBe(
      '"a" | "b" | null'
    )
    expect(describeForkSettingShape({ k: 'array', of: { k: 'string' } })).toBe('string[]')
    expect(describeForkSettingShape({ k: 'record', of: { k: 'boolean' } })).toBe(
      '{ [name]: boolean }'
    )
    expect(describeForkSettingShape(server)).toBe(
      '{ name: string, mode: "allow" | "deny", port?: number, extra?: any }'
    )
    expect(describeForkSettingShape({ k: 'array', of: { k: 'array', of: server } })).toBe('list')
  })
})

describe('forkSettingValuesEqual', () => {
  it('compares by structure, whatever the key order', () => {
    expect(forkSettingValuesEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(
      true
    )
    expect(forkSettingValuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(forkSettingValuesEqual([1, 2], [2, 1])).toBe(false)
    expect(forkSettingValuesEqual(undefined, null)).toBe(false)
    expect(forkSettingValuesEqual([], {})).toBe(false)
  })
})
