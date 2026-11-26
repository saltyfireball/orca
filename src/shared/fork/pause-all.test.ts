// Pause all (BAD-685): the saved switch reads back as engaged unless it plainly says otherwise.
import { describe, expect, it } from 'vitest'
import {
  ForkPauseAllSetParams,
  PAUSE_ALL_CORRUPT,
  PAUSE_ALL_OFF,
  formatPauseAll,
  parsePauseAll,
  parsePauseAllAnswer,
  pauseAllRefusal,
  serializePauseAll
} from './pause-all'

describe('parsePauseAll', () => {
  it('counts anything unreadable as engaged', () => {
    for (const text of [
      '',
      'not json',
      '[]',
      'null',
      '{"version":2,"engaged":false}',
      '{"version":1}',
      '{"version":1,"engaged":"no"}',
      '{"engaged":false}'
    ]) {
      expect(parsePauseAll(text)).toEqual(PAUSE_ALL_CORRUPT)
    }
    expect(PAUSE_ALL_CORRUPT).toMatchObject({ engaged: true, corrupt: true })
  })

  it('reads a switch that is off, and an engaged one with its own fields', () => {
    expect(parsePauseAll(serializePauseAll(PAUSE_ALL_OFF))).toEqual(PAUSE_ALL_OFF)
    const on = { engaged: true, since: 5, by: 'cli', note: 'window', corrupt: false }
    expect(parsePauseAll(serializePauseAll(on))).toEqual(on)
  })

  it('drops fields of the wrong kind without losing the engaged state', () => {
    expect(parsePauseAll('{"version":1,"engaged":true,"since":"x","by":4,"note":{}}')).toEqual({
      engaged: true,
      since: null,
      by: null,
      note: null,
      corrupt: false
    })
  })
})

describe('messages and params', () => {
  it('says why a gate skipped, and that an unreadable switch counts', () => {
    expect(pauseAllRefusal(PAUSE_ALL_OFF)).toContain('Paused by pause-all')
    expect(pauseAllRefusal(PAUSE_ALL_CORRUPT)).toContain('counts as engaged')
  })

  it('lists each paired server that did not take the change', () => {
    const text = formatPauseAll({
      state: { engaged: true, since: 0, by: 'cli', note: null, corrupt: false },
      hosts: [
        { name: 'a', status: 'applied', engaged: true },
        { name: 'b', status: 'unreachable' },
        { name: 'c', status: 'refused', detail: 'update it' }
      ]
    })
    expect(text).toContain('a: paused')
    expect(text).toContain('b: unreachable')
    expect(text).toContain('c: refused (update it)')
    expect(formatPauseAll({ state: PAUSE_ALL_OFF, hosts: [] })).toBe('Not paused.')
  })

  it('prints held counts only while paused, also when an older host sends them', () => {
    const held = { mail: 6, handOffs: 0, launches: 0 }
    expect(formatPauseAll({ state: PAUSE_ALL_OFF, hosts: [], held })).toBe('Not paused.')
    const paused = { engaged: true, since: null, by: 'cli', note: null, corrupt: false }
    expect(formatPauseAll({ state: paused, hosts: [], held })).toContain(
      'Held for resume-all: 6 bot mail'
    )
  })

  it("prints the host's held line while paused, also with nothing held, and words it for an older host", () => {
    const paused = { engaged: true, since: null, by: 'cli', note: null, corrupt: false }
    const held = { mail: 0, handOffs: 0, launches: 0, letters: 1 }
    const after = (result: Parameters<typeof formatPauseAll>[0]) =>
      formatPauseAll(result).split('\n').slice(1)
    // A host newer than this CLI words what it holds; the line is printed as one, cleaned.
    const heldLine = 'Held for resume-all: 3 things\u0007\nthis CLI does not know.'
    expect(after({ state: paused, hosts: [], held, heldLine })).toEqual([
      'Held for resume-all: 3 things this CLI does not know.'
    ])
    expect(after({ state: paused, hosts: [], held })).toEqual([
      'Held for resume-all: 0 bot mail, 0 room hand-offs, 0 worker launches (orca agent queue list), 1 letter (orca letter list).'
    ])
    // An older host counts no letters.
    expect(after({ state: paused, hosts: [], held: { mail: 0, handOffs: 0 } })).toEqual([
      'Held for resume-all: 0 bot mail, 0 room hand-offs, 0 worker launches (orca agent queue list).'
    ])
    expect(formatPauseAll({ state: PAUSE_ALL_OFF, hosts: [], held, heldLine })).toBe('Not paused.')
  })

  it('reads a server answer, and refuses an unrelated one', () => {
    expect(parsePauseAllAnswer({ state: { engaged: true } })).toBe(true)
    expect(parsePauseAllAnswer({ state: {} })).toBeNull()
    expect(parsePauseAllAnswer(null)).toBeNull()
  })

  it('bounds the note', () => {
    expect(ForkPauseAllSetParams.safeParse({ engaged: true, note: 'x'.repeat(501) }).success).toBe(
      false
    )
    expect(ForkPauseAllSetParams.safeParse({ engaged: true }).success).toBe(true)
  })
})
