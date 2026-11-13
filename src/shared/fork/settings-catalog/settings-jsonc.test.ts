// Settings from the CLI (FORK.md): the settings file, written and read.
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../constants'
import { parseForkSettingsFile, renderForkSettingsFile } from './settings-jsonc'
import { redactForkSettings } from './settings-plan'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }
const SECRET = 'proxy-password-that-must-not-leak'
const snapshot = redactForkSettings(
  {
    ...defaults,
    terminalFontSize: 17,
    httpProxyUrl: `http://user:${SECRET}@proxy.example:8080`,
    nestedWorkerMaxDepth: 2
  },
  defaults
)

describe('parseForkSettingsFile', () => {
  it('reads JSON with comments and trailing commas', () => {
    const text = [
      '// a comment',
      '{',
      '  /* block',
      '     comment */',
      '  "a": 1, // trailing',
      '  "b": "has // no comment and a , } inside",',
      '  "c": [1, 2,],',
      '  "d": { "e": "quote \\" // still text", },',
      '}'
    ].join('\n')
    expect(parseForkSettingsFile(text)).toEqual({
      a: 1,
      b: 'has // no comment and a , } inside',
      c: [1, 2],
      d: { e: 'quote " // still text' }
    })
  })

  it('names the line of a syntax error', () => {
    expect(() => parseForkSettingsFile('{\n  // note\n  "a": 1\n  "b": 2\n}')).toThrow(
      /not valid JSON \(line 4\)/
    )
  })

  it('refuses a file that is not one object', () => {
    expect(() => parseForkSettingsFile('[1]')).toThrow(/must hold one object/)
  })
})

describe('renderForkSettingsFile', () => {
  const file = renderForkSettingsFile(snapshot)

  it('groups keys by area under a description, type and default', () => {
    expect(file).toContain('  // ==== Terminal ====')
    expect(file).toContain(
      [
        '  // Font size of terminal text.',
        `  // type: number   default: ${defaults.terminalFontSize}`,
        '  "terminalFontSize": 17,'
      ].join('\n')
    )
    expect(file.indexOf('==== Terminal ====')).toBeLessThan(
      file.indexOf('==== Editor and diffs ====')
    )
    expect(file).toMatch(/^[\t\n\x20-\x7E]*$/)
  })

  it('writes a secret as a comment that says only whether it is set', () => {
    expect(file).not.toContain(SECRET)
    expect(file).toContain('  // secret: set. The value is never written to this file.')
    expect(parseForkSettingsFile(file)).not.toHaveProperty('httpProxyUrl')
  })

  it('writes read-only keys as comments, so apply never sees them', () => {
    expect(file).toContain('  // "nestedWorkerMaxDepth": 2,')
    expect(parseForkSettingsFile(file)).not.toHaveProperty('nestedWorkerMaxDepth')
    expect(parseForkSettingsFile(file)).not.toHaveProperty('pluginConsents')
  })

  it('keeps only changed keys with changedOnly', () => {
    const changed = renderForkSettingsFile(snapshot, { changedOnly: true })
    expect(Object.keys(parseForkSettingsFile(changed))).toEqual(['terminalFontSize'])
    expect(changed).toContain('httpProxyUrl')
    expect(changed).not.toContain('"terminalFontFamily"')
  })
})
