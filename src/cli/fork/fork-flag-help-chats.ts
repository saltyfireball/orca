// Option text of the fork's chat, bot and profile commands (BAD-764).
// Each line is for `orca <command> --help`; fork-flag-help.ts prints it.
import type { ForkFlagHelp, ForkFlagHelpLine } from './fork-flag-help-line'

const SLEEPER_HELP: ForkFlagHelpLine = [
  '<id>',
  'Chat or terminal agent, as `orca sleepers list` prints it; also accepted positionally'
]
const SESSION_HELP: ForkFlagHelpLine = ['<id>', 'Chat session id; also accepted positionally']
const NAME_HELP: ForkFlagHelpLine = ['<name>', 'Agent profile; also accepted positionally']
const INBOX_ITEM_HELP: ForkFlagHelpLine = [
  '<id>',
  'Chat or terminal agent, as `orca inbox list` prints it; also accepted positionally'
]
const PR_HELP: ForkFlagHelpLine = [
  '<pull-request>',
  'Pull request URL, owner/repo#12 or host/owner/repo#12; also accepted positionally'
]
const OWN_CHAT_HELP: ForkFlagHelpLine = [
  '<id>',
  'Chat session id (inside a chat, defaults to that chat); also accepted positionally'
]
const BOARD_ASK_HELP: ForkFlagHelpLine = [
  '<id>',
  'Ask, as `orca board list` prints it, or a prefix of 4+ characters; also accepted positionally'
]

const OWNER_STEPS_HELP: Record<string, ForkFlagHelpLine> = {
  steps: ['<json|lines>', 'Steps for your owner, written as in --steps-file'],
  'steps-file': ['<file|->', 'Read the steps from a file or stdin (JSON or step: lines)']
}

export const FORK_CHAT_FLAG_HELP: ForkFlagHelp = {
  'account which': {
    session: ['<id>', 'Only the chat with this session id']
  },
  'account move': {
    account: [
      '<id|email|system>',
      'Claude account of that host to move to; also accepted positionally'
    ],
    session: ['<id>', 'Chat session id (inside a chat, defaults to that chat)'],
    now: ['', 'Stop a running turn instead of waiting for it to end']
  },
  'agent close': {
    id: ['<id>', 'Orca session ID of the chat (orca_session_id:...)']
  },
  // BAD-873: custom ACP agents.
  'agent custom add': {
    name: ['<name>', 'Lowercase letters, digits and dashes; also accepted positionally'],
    command: ['<program>', 'Absolute path, or a name on PATH, of a program speaking ACP on stdio'],
    arg: ['<arg>', 'One argument for the program; repeat for more, in order'],
    'args-json': ['<json>', 'Arguments as a JSON array of strings, after any --arg'],
    cwd: ['<folder>', "Absolute folder it starts in (default: the chat's workspace)"],
    env: ['<NAME>', 'Variable it gets, valued from this shell; repeat; never NAME=VALUE'],
    'env-file': ['<file>', 'NAME=VALUE lines of variables it gets'],
    'owns-prompt': ['', "It keeps its own persona: a bot sends it Orca's bot rules only"],
    replace: ['', 'Replace a saved agent of the same name']
  },
  'agent custom remove': {
    name: ['<name>', 'Saved custom agent to remove; also accepted positionally']
  },
  'bot chats-cleanup': {
    bot: ['<name>', "Only this bot's chats (its name or id)"],
    'dry-run': ['', 'List what would close and why; close nothing'],
    'include-remote': ['', "Also have every paired server close its own bots' chats"]
  },
  'sleepers sleep': {
    id: SLEEPER_HELP,
    'all-idle': ['', 'Sleep every idle chat that is not pinned'],
    'except-visible': ['', 'With --all-idle: leave chats on screen awake']
  },
  'sleepers wake': {
    id: SLEEPER_HELP
  },
  'sleepers pin': {
    id: SLEEPER_HELP
  },
  'sleepers unpin': {
    id: SLEEPER_HELP
  },
  'mcp-profile list': {
    folder: ['<path>', 'Also list the servers Claude would load in this folder']
  },
  'mcp-profile show': {
    session: SESSION_HELP
  },
  'mcp-profile set': {
    session: SESSION_HELP,
    profile: [
      '<name|default>',
      'MCP profile for its next start; default drops its own choice; also accepted positionally'
    ]
  },
  'profiles show': {
    name: NAME_HELP
  },
  'profiles remove': {
    name: NAME_HELP
  },
  'profiles confirm': {
    name: NAME_HELP
  },
  'profiles set': {
    name: NAME_HELP,
    agent: ['<agent>', 'Agent the profile starts; a new profile needs it'],
    model: ['<id>', 'Model it starts on; "" clears it'],
    effort: ['<level>', 'Reasoning effort; "" clears it'],
    'permission-mode': [
      '<mode>',
      'ask, accept-edits, auto or full-access, capped by Settings; "" clears it'
    ],
    'mcp-profile': ['<name>', 'MCP profile it starts with; "" clears it'],
    account: ['<account>', 'Account it starts on (Claude), or system; "" clears it'],
    preamble: ['<text>', 'Text put in front of the prompt or spec; "" clears it'],
    'preamble-file': ['<path>', 'Read the preamble from a file'],
    'when-to-use': ['<text>', 'Note on when to pick this profile; "" clears it']
  },
  'profiles import': {
    path: ['<file-or-folder>', 'Definition file or folder of them; also accepted positionally'],
    agent: ['<agent>', 'Agent of the imported profiles'],
    name: ['<name>', 'Name for the imported profile']
  },
  'inbox answer': {
    id: INBOX_ITEM_HELP,
    text: ['<text>', 'Your answer, sent to the chat unchanged; also accepted positionally']
  },
  'inbox pause': {
    id: INBOX_ITEM_HELP,
    resume: ['', 'Let idle recovery look at the chat again']
  },
  'babysit stop': {
    pr: PR_HELP
  },
  babysit: {
    pr: PR_HELP
  },
  'chat handoff': {
    id: OWN_CHAT_HELP,
    to: ['<codex|claude>', 'Agent that takes the chat over'],
    message: ['<text>', 'What the new agent is asked to do (default: carry on)'],
    fresh: ['', 'Start a new chat even if an earlier one could be continued'],
    stop: ['', 'Stop a running turn first'],
    focus: ['', 'Show the new chat'],
    'dry-run': ['', 'Print the message and start nothing']
  },
  'chat history': {
    id: OWN_CHAT_HELP,
    before: ['<number>', 'Only entries numbered below this one'],
    limit: ['<n>', 'Entries to print (default 20, at most 50)']
  },
  'agent export': {
    id: ['<id>', "The agent's orca_session_id: ID; also accepted positionally"],
    format: ['<md|html|json>', 'File format (default md)'],
    out: ['<file|->', 'Output file, or - to print it (default orca-session-<id>.md here)'],
    redact: ['', 'Remove secrets and home paths from the export'],
    'no-redact': ['', 'Write the export as it is'],
    share: ['', 'Publish the redacted file as an unlisted artifact and print its link']
  },
  'letter send': {
    to: ['<id>', 'Recipient, as `orca letter chats` lists it; also accepted positionally'],
    text: ['<text>', "The letter's text; also accepted positionally"],
    cite: ['<letter-id>', 'Earlier letter between the two chats that this one answers'],
    host: ['<server>', 'Paired server (id or name) the recipient runs on']
  },
  'letter list': {
    chat: ['<id>', 'Letters of this chat (default: the chat that runs it)']
  },
  'board add': {
    type: ['<REVIEW|DECIDE|DO>', 'Kind of ask; also accepted positionally'],
    title: ['<text>', "The ask's title; also accepted positionally"],
    body: ['<text>', "The ask's details, such as a link or the options"]
  },
  'board list': {
    all: ['', 'Also list the asks closed in the last week']
  },
  'board done': {
    id: BOARD_ASK_HELP,
    note: ['<text>', 'Note kept with the ask']
  },
  'board back': {
    id: BOARD_ASK_HELP,
    note: [
      '<text>',
      'What the chat that filed it should do, sent as a message; also accepted positionally'
    ]
  },
  'quick-task': {
    text: ['<text>', 'The task for the router bot; also accepted positionally']
  },
  'bot set': {
    bot: ['<name>', 'Bot to set (name or id)'],
    all: ['', 'Set every bot on the host'],
    agent: ['<agent>', 'With --all: only bots of this agent; with --bot: move it to this agent'],
    model: ['<id>', 'Model its new chats start on'],
    effort: ['<level>', 'Reasoning effort its new chats start on'],
    clear: ['', 'Remove the choice, so new chats start on the native chat defaults']
  },
  'bot connect': {
    bot: ['<name>', 'Bot to link (name or id)'],
    all: ['', 'Link every bot of the computer asked'],
    linear: ['', 'Link the Linear workspaces only'],
    github: ['', 'Link the GitHub account only']
  },
  'bot item add': OWNER_STEPS_HELP,
  'bot item set': OWNER_STEPS_HELP,
  'bot item answer': {
    id: ['<id>', 'Item number or id; also accepted positionally'],
    text: ['<text>', 'The answer or comment'],
    'text-file': ['<path|->', 'Read the text from a file or stdin'],
    question: ['<eN>', 'Answer this question only, e.g. e12'],
    plain: ['', 'Comment without answering the question'],
    bot: ['<name>', 'Refuse an item of any other bot'],
    'request-id': ['<id>', 'A retry with the same id returns the comment already made'],
    'owner-token-file': ['<path>', 'File with the owner token (mode 600); else ORCA_OWNER_TOKEN']
  },
  digest: {
    since: ['<when>', 'How far back (90m, 12h, 2d, 1w) or a date and time; at most 90 days']
  },
  'card route': {
    key: ['<KEY>', 'Linear card, e.g. ABC-12; also accepted positionally'],
    'hand-off': ['', 'Start that bot in a new chat on the card'],
    bot: ['<name>', 'Hand the card to this bot'],
    'label-only': ['', 'Do nothing unless a bot: label decides']
  }
}
