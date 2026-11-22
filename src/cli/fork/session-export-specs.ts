// Session export (FORK.md, BAD-688): `orca agent export`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_SESSION_EXPORT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'export'],
    summary: 'Write an agent conversation to a Markdown, HTML or JSON file, or share it as a link',
    usage:
      'orca agent export <id> [--format md|html|json] [--out <file>|-] [--redact|--no-redact] [--share] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'format', 'out', 'redact', 'no-redact', 'share'],
    booleanFlags: ['redact', 'no-redact', 'share'],
    positionalArgs: ['id'],
    notes: [
      '<id> is the `orca_session_id:` ID from `orca agent list`. A chat is exported with its requests and answers in full and each tool call or file edit as one collapsed line; a terminal agent with what `orca agent read` shows.',
      'The default is a file in the current folder (orca-session-<id>.md); --out names another file, and --out - prints to the terminal. The HTML is one self-contained file with no script.',
      'Redaction removes API keys and tokens by their shape, values of KEY, TOKEN, SECRET and PASSWORD names, private keys, credentials in URLs and home folder paths. It is on by default (Settings > Blackfish, session export); --no-redact writes the file as it is. It is a safety net: read an export before you hand it on.',
      '--share is a separate, explicit step: it writes the redacted Markdown or HTML file, then publishes it as an unlisted Orca artifact and prints the link. Anyone with the link can read it. Redaction cannot be turned off for a share, and sharing needs artifact sharing on and a signed-in desktop (`orca artifacts` rules).',
      'At most the newest 500 entries are exported (`forkSessionExportMaxEntries`); `forkSessionExportIncludeActivity` drops the tool lines. A terminal agent reads the same window as `orca agent read`.',
      '--environment exports a chat that runs on a paired host; --share runs on this desktop only.'
    ],
    examples: [
      'orca agent export orca_session_id:3540ecf3-47c3-4876-b825-81bf5d6b3595',
      'orca agent export orca_session_id:3540ecf3-47c3-4876-b825-81bf5d6b3595 --format html --out review.html',
      'orca agent export orca_session_id:3540ecf3-47c3-4876-b825-81bf5d6b3595 --share'
    ]
  }
]
