import { afterEach, describe, expect, it } from 'vitest'
import {
  isNativeChatVisualFileName,
  NATIVE_CHAT_VISUAL_MAX_BYTES,
  parseNativeChatVisualDirectiveLine,
  withoutNativeChatVisualDirectiveLines
} from '../native-chat/visuals/native-chat-visual-directive'
import {
  forkVisualMaxDocumentChars,
  readForkVisualFallbackSettings,
  setForkVisualFallbackSettingsReader
} from './visual-image-fallback'

afterEach(() => {
  setForkVisualFallbackSettingsReader(() => null)
})

describe('visual fallback grammar (SLRM-2349)', () => {
  it('reads the line from the card: an unquoted image name and a quoted title', () => {
    expect(
      parseNativeChatVisualDirectiveLine(
        '::orca-visual{file=portrait-hair-2324.jpg title="Hair pass"}'
      )
    ).toEqual({ file: 'portrait-hair-2324.jpg', title: 'Hair pass' })
  })

  it('takes png, jpg, jpeg, gif and webp in any case, and unquoted .html names', () => {
    for (const file of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'chart.html']) {
      expect(parseNativeChatVisualDirectiveLine(`::orca-visual{file=${file}}`)?.file).toBe(file)
    }
  })

  it('keeps every name rule', () => {
    for (const file of [
      'logo.svg',
      '../a.png',
      'a/b.png',
      'a\\b.png',
      '.png',
      'a..b.png',
      'con.png',
      'LPT1.jpg',
      'a.png:stream',
      `${'x'.repeat(130)}.png`
    ]) {
      expect(isNativeChatVisualFileName(file), file).toBe(false)
    }
  })

  it('refuses unquoted values with quotes, braces, backslashes or a missing separator', () => {
    for (const line of [
      '::orca-visual{file=a.png"}',
      "::orca-visual{file=a'.png}",
      '::orca-visual{file=a{b}.png}',
      '::orca-visual{file=a\\b.png}',
      '::orca-visual{file=a.png title=x"y}',
      '::orca-visual{file="a.png"title=x}',
      '::orca-visual{file=}'
    ]) {
      expect(parseNativeChatVisualDirectiveLine(line), line).toBeNull()
    }
  })

  it('goes back to the stock grammar when the setting is off', () => {
    setForkVisualFallbackSettingsReader(() => ({ forkVisualFallback: false }))
    expect(parseNativeChatVisualDirectiveLine('::orca-visual{file="a.png"}')).toBeNull()
    expect(parseNativeChatVisualDirectiveLine('::orca-visual{file=chart.html}')).toBeNull()
    expect(parseNativeChatVisualDirectiveLine('::orca-visual{file="chart.html"}')).toEqual({
      file: 'chart.html',
      title: null
    })
  })

  it('strips fallback lines from previews like stock ones', () => {
    expect(
      withoutNativeChatVisualDirectiveLines('Look:\n\n::orca-visual{file=a.png}\n\nDone')
    ).toBe('Look:\n\nDone')
  })

  it('reads the settings with defaults and bounds', () => {
    expect(readForkVisualFallbackSettings(null)).toEqual({
      enabled: true,
      imageMaxBytes: 4 * 1024 * 1024
    })
    expect(readForkVisualFallbackSettings({ forkVisualImageMaxMiB: 9 }).imageMaxBytes).toBe(
      4 * 1024 * 1024
    )
    expect(readForkVisualFallbackSettings({ forkVisualFallback: 'no' }).enabled).toBe(true)
  })

  it('a throwing reader falls back to the defaults', () => {
    setForkVisualFallbackSettingsReader(() => {
      throw new Error('store not ready')
    })
    expect(isNativeChatVisualFileName('a.png')).toBe(true)
  })

  it('lets a client take a page around the largest image', () => {
    const chars = forkVisualMaxDocumentChars(NATIVE_CHAT_VISUAL_MAX_BYTES)
    expect(chars).toBeGreaterThan(Math.ceil((5 * 1024 * 1024) / 3) * 4)
    expect(chars).toBeLessThan(8 * 1024 * 1024)
  })
})
