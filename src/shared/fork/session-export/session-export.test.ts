import { describe, expect, it } from 'vitest'
import {
  limitSessionExportEntries,
  readSessionExportSettings,
  type SessionExportDocument
} from './session-export'
import { redactSessionExport, redactSessionExportText } from './session-export-redact'
import {
  renderSessionExportHtml,
  renderSessionExportJson,
  renderSessionExportMarkdown
} from './session-export-render'

const claudeChat: SessionExportDocument = {
  id: 'orca_session_id:11111111-1111-4111-8111-111111111111',
  kind: 'chat',
  agent: 'claude',
  title: 'Fix the login bug',
  truncated: false,
  homeDirs: ['/Users/sam'],
  entries: [
    {
      role: 'user',
      text: 'Login fails with a 500. Use ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop1234.'
    },
    { role: 'activity', text: 'Read /Users/sam/app/login.ts -> done' },
    { role: 'activity', text: 'Edit /Users/sam/app/login.ts -> done' },
    {
      role: 'assistant',
      text: 'The handler threw on a null user.\n\nFixed in /Users/sam/app/login.ts.'
    }
  ]
}

const codexChat: SessionExportDocument = {
  id: 'orca_session_id:22222222-2222-4222-8222-222222222222',
  kind: 'chat',
  agent: 'codex',
  title: '',
  truncated: true,
  homeDirs: [],
  entries: [
    { role: 'user', text: 'Run the tests' },
    { role: 'assistant', text: 'All 12 pass.\n```\nok\n```' }
  ]
}

const claudeTerminal: SessionExportDocument = {
  id: 'orca_session_id:33333333-3333-4333-8333-333333333333',
  kind: 'terminal',
  agent: 'claude',
  title: 'Claude session',
  truncated: false,
  homeDirs: [],
  entries: [
    { role: 'user', text: 'List the files' },
    { role: 'activity', text: 'Bash -> completed' },
    { role: 'assistant', text: 'There are two files.' }
  ]
}

describe('session export markdown', () => {
  it('renders a Claude chat in order with collapsed tool calls', () => {
    expect(renderSessionExportMarkdown(claudeChat)).toBe(
      [
        '# Fix the login bug',
        '',
        '_Chat (claude), 4 entries_',
        '',
        '## User',
        '',
        'Login fails with a 500. Use ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop1234.',
        '',
        '<details>',
        '<summary>2 tool calls</summary>',
        '',
        '```',
        'Read /Users/sam/app/login.ts -> done',
        'Edit /Users/sam/app/login.ts -> done',
        '```',
        '',
        '</details>',
        '',
        '## Assistant',
        '',
        'The handler threw on a null user.',
        '',
        'Fixed in /Users/sam/app/login.ts.',
        ''
      ].join('\n')
    )
  })

  it('renders a Codex chat, names an untitled one and says it was cut', () => {
    expect(renderSessionExportMarkdown(codexChat)).toBe(
      [
        '# codex session',
        '',
        '_Chat (codex), 2 entries_',
        '',
        '> Older entries or long text were left out of this export (see Settings > Blackfish, session export).',
        '',
        '## User',
        '',
        'Run the tests',
        '',
        '## Assistant',
        '',
        'All 12 pass.',
        '```',
        'ok',
        '```',
        ''
      ].join('\n')
    )
  })

  it('renders a terminal Claude session', () => {
    expect(renderSessionExportMarkdown(claudeTerminal)).toBe(
      [
        '# Claude session',
        '',
        '_Terminal agent (claude), 3 entries_',
        '',
        '## User',
        '',
        'List the files',
        '',
        '<details>',
        '<summary>1 tool call</summary>',
        '',
        '```',
        'Bash -> completed',
        '```',
        '',
        '</details>',
        '',
        '## Assistant',
        '',
        'There are two files.',
        ''
      ].join('\n')
    )
  })

  it('fences tool lines that hold backticks with a longer fence', () => {
    const doc: SessionExportDocument = {
      ...claudeTerminal,
      entries: [{ role: 'activity', text: 'Bash echo ``` -> done' }]
    }
    expect(renderSessionExportMarkdown(doc)).toContain('````\nBash echo ``` -> done\n````')
  })
})

describe('session export html', () => {
  it('is one self-contained file with escaped text, no script and a closed policy', () => {
    const doc: SessionExportDocument = {
      ...claudeTerminal,
      title: 'A <b>&"title"',
      entries: [
        { role: 'user', text: '<script>alert(1)</script>' },
        { role: 'activity', text: 'Bash -> done' }
      ]
    }
    const html = renderSessionExportHtml(doc)
    expect(html).toContain('<title>A &lt;b&gt;&amp;&quot;title&quot;</title>')
    expect(html).toContain(
      '<section class="turn user"><p class="role">User</p><p class="text">&lt;script&gt;alert(1)&lt;/script&gt;</p></section>'
    )
    expect(html).toContain(
      '<details><summary>1 tool call</summary><pre>Bash -&gt; done</pre></details>'
    )
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    )
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/(?:src|href)=/)
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true)
    expect(html.endsWith('</body>\n</html>\n')).toBe(true)
  })
})

describe('session export json', () => {
  it('is the document, indented', () => {
    expect(renderSessionExportJson(claudeTerminal)).toBe(
      `${JSON.stringify(claudeTerminal, null, 2)}\n`
    )
  })
})

describe('session export redaction', () => {
  it('removes secrets by shape and by env-like name', () => {
    const text = [
      'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop1234',
      'export GITHUB_TOKEN="ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      '{"password": "hunter2hunter2"}',
      'curl -H "Authorization: Bearer abcdefghijklmnop12345678"',
      'https://user:pa55word@example.com/x',
      'aws AKIAABCDEFGHIJKLMNOP',
      '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'
    ].join('\n')
    expect(redactSessionExportText(text)).toBe(
      [
        'ANTHROPIC_API_KEY=[redacted]',
        'export GITHUB_TOKEN=[redacted]',
        '{"password": [redacted]}',
        'curl -H "Authorization: Bearer [redacted]"',
        'https://user:[redacted]@example.com/x',
        'aws [redacted]',
        '[redacted]'
      ].join('\n')
    )
  })

  it('keeps ordinary prose and short words', () => {
    const text = 'Author: Sam. The keyboard works; press a key. Use main.'
    expect(redactSessionExportText(text)).toBe(text)
  })

  it('replaces the host home and any other home folder with ~', () => {
    expect(
      redactSessionExportText('/srv/sam/code/a.ts and /Users/kim/x and C:\\Users\\Lee\\y', [
        '/srv/sam'
      ])
    ).toBe('~/code/a.ts and ~/x and ~\\y')
  })

  it('redacts title and entries and drops the host folders', () => {
    const redacted = redactSessionExport(claudeChat)
    expect(redacted.homeDirs).toEqual([])
    expect(redacted.entries.map((entry) => entry.text)).toEqual([
      'Login fails with a 500. Use ANTHROPIC_API_KEY=[redacted].',
      'Read ~/app/login.ts -> done',
      'Edit ~/app/login.ts -> done',
      'The handler threw on a null user.\n\nFixed in ~/app/login.ts.'
    ])
  })
})

describe('session export settings', () => {
  it('defaults to redacting, 500 entries and tool lines kept', () => {
    expect(readSessionExportSettings(null)).toEqual({
      redact: true,
      maxEntries: 500,
      includeActivity: true
    })
  })

  it('clamps the entry count and reads the switches', () => {
    expect(
      readSessionExportSettings({
        forkSessionExportRedact: false,
        forkSessionExportMaxEntries: 1,
        forkSessionExportIncludeActivity: false
      })
    ).toEqual({ redact: false, maxEntries: 10, includeActivity: false })
  })

  it('keeps the newest entries and can drop tool lines', () => {
    const entries = claudeChat.entries
    expect(limitSessionExportEntries(entries, { maxEntries: 2, includeActivity: true })).toEqual({
      entries: entries.slice(2),
      cut: true
    })
    expect(
      limitSessionExportEntries(entries, { maxEntries: 10, includeActivity: false }).entries
    ).toHaveLength(2)
  })
})
