# Custom ACP agents (BAD-873)

A custom ACP agent is a program you name that speaks the Agent Client Protocol (ACP) over stdio.
Orca runs it as a native chat, from the CLI or the + menu, and a bot can run on it. This page is
the contract an adapter has to meet. FORK.md "Custom ACP agents" covers the Orca side.

## Defining one

```sh
orca agent custom add pebble --command /opt/pebble/bin/pebble-acp --arg --acp \
  --env PEBBLE_TOKEN --cwd /srv/pebble [--owns-prompt] [--replace]
orca agent custom list
orca agent custom remove pebble
```

- `name`: 1 to 40 lowercase letters, digits and dashes. It cannot be a built-in agent id. At most
  32 agents per host.
- `--command`: one program, either an absolute path or a name looked up on the `PATH` Orca gives
  agents.
- `--arg` (repeatable) and `--args-json '["--a","b"]'`: the arguments, in that order.
- `--cwd`: an absolute folder the program starts in. When it is left out, the program starts in
  the chat's workspace folder.
- `--env NAME` (repeatable): the value is taken from the shell running the CLI.
  `--env-file FILE` reads `NAME=VALUE` lines (`#` comments, `export` and quotes are allowed).
  - `--env NAME=VALUE` is refused, so a value never sits in shell history or the process list.
  - `PATH`, `HOME`, `USERPROFILE` and `ORCA_*` are refused, because Orca sets those.
- `--owns-prompt`: the agent keeps its own persona. See Persona below.

Values are stored apart from settings, in `<userData>/fork-custom-acp-agents/env.json`. The file
is mode 0600 in a 0700 folder. Settings, `orca agent custom list` and logs carry only the names.
`list` names any variable that has no stored value. The agents themselves are kept in the
`forkCustomAcpAgents` setting. `orca settings set` refuses that key: only `orca agent custom`
changes it.

## Starting chats

- `orca agent launch --agent pebble [--worktree <selector>] [--prompt <text>] [--focus]` opens a
  chat on the saved agent.
- Flags the agent cannot honor are refused with the reason instead of being dropped:
  - `--model` and `--effort`: the agent picks its own model.
  - `--surface terminal`: a custom agent runs as a chat only.
  - `--profile` and `--mcp-profile`: agent profiles and Orca MCP profiles do not apply.
  - `--retry-launch`: a chat start on a custom agent has no launch retry.
- The + menu of a workspace lists the host's saved agents under "Custom agents".
- `custom-acp` itself is never in the generic agent rows. It is never detected on PATH and never
  offered as a terminal agent.
- A chat stays on the agent it was started on (its private folder pins it). Saving the agent again
  with `--replace` changes the program for that chat's next start.
- Removing the agent makes its chats refuse to start again, with this message: "The custom agent
  pebble is not saved on this host any more; add it again with orca agent custom add pebble."
- A start that names no saved agent is refused with the reason, before any chat is made.

## Bots

`orca bot set --bot Lantern --agent pebble` moves a bot to a saved custom agent. Its Home chat is
replaced the next time it opens, and its new chats start there. `--model`, `--effort` and `--clear`
are refused with a custom agent, and so is `--agent custom-acp` without a name.

## The process

- **Command and arguments.** Exactly as saved. Orca adds no arguments.
- **Folder.** The saved `--cwd`, or else the chat's workspace folder.
- **Environment.** The usual environment Orca gives every agent it starts, plus:
  - each saved variable, with its stored value.
  - `ORCA_CUSTOM_AGENT_HOME`: a private folder for this agent,
    `<userData>/fork-custom-acp-agents/agents/<name>` (mode 0700). It is the same for every chat
    on the agent. The agent may keep its own state there.
- **Supervision.** Orca runs the program under its provider supervisor, like any agent. When a
  chat closes, Orca stops the program and its process tree. The program should also exit by
  itself when stdin closes.
- **Transport.** Newline-delimited JSON-RPC 2.0 on stdout and stdin. stderr is never chat text.
  When a start fails, its last lines can appear in the failure's Details.

## The handshake

`initialize` params:

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": { "readTextFile": false, "writeTextFile": false },
    "terminal": false
  },
  "clientInfo": { "name": "orca", "version": "<Orca's app version>" }
}
```

- The agent must answer `protocolVersion: 1`. Any other version fails the start.
- `agentCapabilities.loadSession: true` (or `sessionCapabilities.resume`) lets a chat be reopened.
  See Sessions below.
- `agentCapabilities._meta.orca.systemPrompt: true` says the agent takes Orca's standing
  instructions. See Persona below.
- `authMethods` is read, but Orca never calls `authenticate` for a custom agent. Sign the agent in
  outside Orca.

## Persona (question 1)

Orca sends persona text only to bot chats. A plain chat sends no `_meta` on `session/new` or
`session/load`, so a plain chat works with any agent. For a bot chat, the agent's saved
`--owns-prompt` decides:

| Saved as        | The agent advertises `_meta.orca.systemPrompt: true` | What Orca sends                                                                                                                                  |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--owns-prompt` | either way                                           | `_meta.orca.context`: Orca's bot rules (tools and rules) only, never SOUL.md or MEMORY.md. The agent may use the text or ignore it.              |
| not owned       | yes                                                  | `_meta.orca.systemPrompt`: the whole bot preamble (SOUL.md, MEMORY.md and the bot rules)                                                         |
| not owned       | no                                                   | Nothing. The chat refuses to start, and its failure Details say to save the agent with `--owns-prompt --replace` or to advertise the capability. |

- **Where it goes.** The text is in the `_meta` of `session/new`, and again on every
  `session/load` (or `session/resume`), so an edit to SOUL.md reaches the next start.
- **Turns.** For an agent that owns its prompt, a turn's `session/prompt` carries the message (the
  person's text or the bot's mail) and none of SOUL.md or MEMORY.md.
- **What Orca reads.** Orca reads no persona from the agent. Only the capability flag above
  matters, and `protocolVersion` must be 1.

## Sessions (questions 2 and 3)

- **`session/new`.**
  - `cwd`: the chat's workspace folder (absolute). This is the workspace even when the process
    runs in a saved `--cwd`.
  - `mcpServers`: an array that is always sent. It is `[]` for a plain chat. A bot chat may list
    its tool servers (stdio entries).
  - An agent that cannot run MCP servers may ignore `mcpServers`. Those tools are then simply
    missing from the chat, and nothing fails.
  - Persona `_meta` is sent as above.
- **The session id.** Orca keeps the `sessionId` from the `session/new` answer in the chat's own
  record, one per chat, across restarts.
- **Reopening.** Orca reopens a chat after an app restart, a crash, or an idle close. It starts the
  program again and sends `initialize`. Then:
  - with `loadSession`, it sends `session/load {sessionId, cwd, mcpServers}`.
  - otherwise, with `sessionCapabilities.resume`, it sends `session/resume` with the same fields.

  If the reopen fails, Orca starts a new session (`session/new`) for the chat. That covers an
  agent that offers neither, an error answer (for example `-32002` for an unknown session), and a
  bad answer. The chat then shows a row saying the saved session could not be reopened, and the
  agent has none of the earlier context. Two failures fail the start instead: `-32000` (signed
  out) and a request that runs past its deadline.

- **Replay.** Updates the agent sends while `session/load` runs are treated as history. Orca
  already holds the chat in its own journal, so it does not show them again.

## Turns

- `session/prompt {sessionId, prompt: [{type: "text", text}]}`. Images are sent only when
  `promptCapabilities.image` is advertised.
- **Streaming.** `session/update` with `agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
  `tool_call_update` and `plan` streams into the chat as it arrives.
- **End of turn.** The `session/prompt` result's `stopReason` (`end_turn`, `max_tokens`,
  `max_turn_requests`, `refusal`, `cancelled`) ends the turn.
- **Stop.** The chat's Stop sends the `session/cancel {sessionId}` notification. The agent should
  then finish the prompt with `stopReason: "cancelled"`.
- **Permissions.** `session/request_permission` is answered by the chat's permission mode, as for
  any ACP chat.
- **Pickers.** Orca lists no models for a custom agent ("A custom ACP agent picks its own model;
  Orca lists none for it"), so there is no model or effort to pick. The CLI refuses `--model` and
  `--effort` with the reason.
- **Pause all.** While Pause all is on, a bot's custom agent chats take no mail and start no
  background turns, like any other agent's chats. Resume-all delivers the held mail once. A
  person's own start (CLI or + menu) is not held.

## Errors (question 4)

- **A JSON-RPC error on `session/prompt`.** The chat shows the error's `message` on the turn's
  failure row. `error.data.details`, or a string `error.data`, is shown in its Details.
  Example: `{"code": -32001, "message": "The pebble service is unreachable."}` shows that
  sentence.
- **`-32000`.** It means the agent needs signing in. The chat says the agent is signed out, and a
  reopen does not start a new session over it. Orca has no sign-in command for a custom agent.
- **A failure before the first turn.** If the program cannot be found, exits during the handshake,
  or answers `initialize` badly, the chat fails to start. Its Details show the reason, or the
  program's last stderr lines.
- **Orca's own refusals.** These say what to change: an unsaved or removed agent, a missing
  system-prompt capability, or values still loading at startup.
