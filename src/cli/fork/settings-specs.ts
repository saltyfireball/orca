// Settings from the CLI (FORK.md): `orca settings`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

const WRITE_NOTE =
  'The change goes through the running app, which checks and normalizes it as the Settings screen does, and open windows update at once.'
const REFUSE_NOTE =
  'An unknown key, a value of the wrong type or a read-only key is refused with the key named, and then nothing is written.'

export const FORK_SETTINGS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['settings', 'list'],
    summary: 'List every app setting with its value, default, type and description',
    usage: 'orca settings list [--changed] [--filter <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'changed', 'filter'],
    notes: [
      '--changed lists only the settings that differ from their default.',
      '--filter <text> lists the settings whose key, area or description contains the text.',
      'A leading * marks a value that differs from its default. Read-only settings are marked; a secret shows whether it is set, never its value.'
    ],
    examples: [
      'orca settings list',
      'orca settings list --changed',
      'orca settings list --filter terminal --json'
    ]
  },
  {
    path: ['settings', 'get'],
    summary: 'Show one setting: its value, default, type and description',
    usage: 'orca settings get <key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key'],
    positionalArgs: ['key'],
    examples: ['orca settings get terminalFontSize']
  },
  {
    path: ['settings', 'set'],
    summary: 'Change one setting',
    usage: 'orca settings set <key> <value> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'value'],
    positionalArgs: ['key', 'value'],
    notes: [
      'The value is read as JSON (true, 14, "text", ["a"], {"a":1}); anything that is not JSON is taken as plain text.',
      'Write a value that starts with a dash as --value=<value>.',
      WRITE_NOTE,
      REFUSE_NOTE
    ],
    examples: [
      'orca settings set terminalFontSize 15',
      'orca settings set theme dark',
      'orca settings set terminalFontFamily "JetBrains Mono"'
    ]
  },
  {
    path: ['settings', 'reset'],
    summary: 'Put one or more settings back to their default',
    usage: 'orca settings reset <key>... [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key'],
    positionalArgs: ['key'],
    variadicPositional: true,
    repeatableFlags: ['key'],
    notes: [WRITE_NOTE, REFUSE_NOTE],
    examples: ['orca settings reset terminalFontSize terminalLineHeight']
  },
  {
    path: ['settings', 'export'],
    summary: 'Write every setting to one file you can read and edit',
    usage: 'orca settings export [--file <path>] [--changed-only] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'changed-only'],
    notes: [
      'The file is JSON with comments: settings grouped by area, each under its description, type and default.',
      'Without --file it is printed. --changed-only keeps the settings that differ from their default.',
      'Read-only settings and settings with no value are written as comments; a secret shows whether it is set, never its value.',
      'Edit the file and hand it to `orca settings apply`.'
    ],
    examples: ['orca settings export --file settings.jsonc', 'orca settings export --changed-only']
  },
  {
    path: ['settings', 'apply'],
    summary: 'Apply an edited settings file',
    usage: 'orca settings apply --file <path> [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'dry-run'],
    notes: [
      'Prints each change as key, old value and new value. --dry-run prints them and writes nothing.',
      'A setting that is not in the file is left as it is.',
      WRITE_NOTE,
      REFUSE_NOTE
    ],
    examples: [
      'orca settings apply --file settings.jsonc --dry-run',
      'orca settings apply --file settings.jsonc'
    ]
  }
]

/** `orca --help`: the settings commands under their own heading. */
const ROOT_HELP_SECTION = [
  'Settings:',
  ...FORK_SETTINGS_COMMAND_SPECS.map(
    (spec) => `  ${spec.path.join(' ').padEnd(26)}${spec.summary}`
  ),
  ''
].join('\n')

/** Hook in help.ts: puts the section before the root help's "Common Commands". */
export function withForkSettingsRootHelp(rootHelp: string): string {
  const anchor = '\nCommon Commands:'
  const at = rootHelp.indexOf(anchor)
  return at === -1
    ? `${rootHelp}\n\n${ROOT_HELP_SECTION}`
    : `${rootHelp.slice(0, at)}\n${ROOT_HELP_SECTION}${rootHelp.slice(at)}`
}

const FLAG_HELP: Record<string, string> = {
  changed: '--changed              Only settings that differ from their default',
  'changed-only': '--changed-only         Only settings that differ from their default',
  filter: '--filter <text>        Only settings whose key, area or description contains the text',
  key: '--key <key>            Setting key; also accepted positionally',
  value:
    '--value <value>        New value, read as JSON or else as plain text; also accepted positionally',
  file: '--file <path>          Settings file (JSON with comments)',
  'dry-run': '--dry-run              Print the changes and write nothing'
}

/** Hook in help.ts: the option lines of the `orca settings` commands. */
export function forkSettingsFlagHelp(command: string, flag: string): string | undefined {
  return command.startsWith('settings ') ? FLAG_HELP[flag] : undefined
}
