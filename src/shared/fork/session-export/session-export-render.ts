// Session export (FORK.md, BAD-688): a conversation as Markdown, one self-contained HTML file, or
// JSON. Tool calls and file edits stay collapsed. The HTML has no script and no remote asset, and
// its policy forbids both, so a shared page cannot run or fetch anything. Pure.
import type {
  SessionExportDocument,
  SessionExportEntry,
  SessionExportFormat,
  SessionExportRole
} from './session-export'

const ROLE_LABEL: Record<Exclude<SessionExportRole, 'activity'>, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'Note'
}

const TRUNCATED_NOTE =
  'Older entries or long text were left out of this export (see Settings > Blackfish, session export).'

function title(doc: SessionExportDocument): string {
  return doc.title.trim() || `${doc.agent ?? 'Agent'} session`
}

function metaLine(doc: SessionExportDocument): string {
  return `${doc.kind === 'chat' ? 'Chat' : 'Terminal agent'}${doc.agent ? ` (${doc.agent})` : ''}, ${doc.entries.length} entries`
}

/** A Markdown fence longer than any run of backticks in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(longest + 1)
}

type Group = { activity: false; entry: SessionExportEntry } | { activity: true; lines: string[] }

/** Consecutive activity entries become one group, so a run of tool calls is one collapsed block. */
function groupEntries(entries: readonly SessionExportEntry[]): Group[] {
  const groups: Group[] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (entry.role !== 'activity') {
      groups.push({ activity: false, entry })
    } else if (last?.activity) {
      last.lines.push(entry.text)
    } else {
      groups.push({ activity: true, lines: [entry.text] })
    }
  }
  return groups
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function callsLabel(count: number): string {
  return `${count} tool ${count === 1 ? 'call' : 'calls'}`
}

export function renderSessionExportMarkdown(doc: SessionExportDocument): string {
  const out = [`# ${oneLine(title(doc))}`, '', `_${metaLine(doc)}_`]
  if (doc.truncated) {
    out.push('', `> ${TRUNCATED_NOTE}`)
  }
  for (const group of groupEntries(doc.entries)) {
    out.push('')
    if (group.activity) {
      const body = group.lines.map(oneLine).join('\n')
      const fence = fenceFor(body)
      out.push(
        '<details>',
        `<summary>${callsLabel(group.lines.length)}</summary>`,
        '',
        fence,
        body,
        fence,
        '',
        '</details>'
      )
    } else {
      const { entry } = group
      out.push(
        `## ${ROLE_LABEL[entry.role as Exclude<SessionExportRole, 'activity'>]}`,
        '',
        entry.text.trim()
      )
    }
  }
  return `${out.join('\n')}\n`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const HTML_STYLE = `
:root{color-scheme:light dark}
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;background:Canvas;color:CanvasText}
h1{font-size:1.4rem;margin:0 0 .25rem}
.meta{opacity:.65;margin:0 0 1.5rem}
.note{border-left:3px solid #d97706;padding:.4rem .75rem;margin:0 0 1.5rem;background:rgba(217,119,6,.1)}
.turn{margin:0 0 1.25rem;padding:.75rem 1rem;border-radius:8px;border:1px solid rgba(127,127,127,.3)}
.turn.user{background:rgba(59,130,246,.08)}
.turn.system{opacity:.8}
.role{font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;opacity:.7;margin:0 0 .35rem}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit}
details{margin:0 0 1.25rem;opacity:.85}
summary{cursor:pointer;font-size:.85rem}
details pre{margin:.5rem 0 0;padding:.6rem .8rem;border-radius:6px;background:rgba(127,127,127,.12);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace}
`.trim()

export function renderSessionExportHtml(doc: SessionExportDocument): string {
  const name = escapeHtml(oneLine(title(doc)))
  const body = groupEntries(doc.entries).map((group) =>
    group.activity
      ? `<details><summary>${callsLabel(group.lines.length)}</summary><pre>${escapeHtml(group.lines.map(oneLine).join('\n'))}</pre></details>`
      : `<section class="turn ${group.entry.role}"><p class="role">${ROLE_LABEL[group.entry.role as Exclude<SessionExportRole, 'activity'>]}</p><p class="text">${escapeHtml(group.entry.text.trim())}</p></section>`
  )
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="robots" content="noindex">',
    `<title>${name}</title>`,
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${name}</h1>`,
    `<p class="meta">${escapeHtml(metaLine(doc))}</p>`,
    ...(doc.truncated ? [`<p class="note">${escapeHtml(TRUNCATED_NOTE)}</p>`] : []),
    ...body,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

export function renderSessionExportJson(doc: SessionExportDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export function renderSessionExport(
  doc: SessionExportDocument,
  format: SessionExportFormat
): string {
  return format === 'html'
    ? renderSessionExportHtml(doc)
    : format === 'json'
      ? renderSessionExportJson(doc)
      : renderSessionExportMarkdown(doc)
}

export const SESSION_EXPORT_FILE_EXTENSION: Record<SessionExportFormat, string> = {
  md: 'md',
  html: 'html',
  json: 'json'
}
