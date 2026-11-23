// Fork tests (SLRM-2349): the visual directive takes plain values, and refuses a stray or escaped quote.
// Kept apart from upstream's directive tests, which upstream cut from its suite.
import { expect, it } from 'vitest'
import { parseNativeChatVisualDirectiveLine } from './native-chat-visual-directive'

it.each([
  ['unquoted value with a quote', '::orca-visual{file=a.html"}'],
  ['escaped quote', '::orca-visual{file="a.html" title="say \\"hi\\""}']
])('refuses %s', (_name, line) => {
  expect(parseNativeChatVisualDirectiveLine(line)).toBeNull()
})
