# Idle recovery and the Decision inbox (Blackfish)

An agent's turn can end in two ways that leave you worse off than a plain "done". It asks you a
question and the chat sits unseen, or it says "I will run the tests next" and stops without
running them. Idle recovery reads how each idle chat ended, lists the chats that wait on you in
the Decision inbox, and, if you choose, sends a stalled chat a message to carry on.

It is off by default. While it is off nothing runs: no chat is read, no process is started and no
file is written.

Code: `src/shared/fork/idle-recovery*.ts` (the contract and the rules),
`src/main/fork/idle-recovery/` (the sweep), `src/renderer/src/fork/decision-inbox/` (the inbox)
and `src/cli/fork/inbox-*.ts` (`orca inbox`).

## The three modes

Settings > Advanced > Idle recovery, or `orca settings set forkIdleSweepMode <mode>`.

| Mode    | What it does                                                                               |
| ------- | ------------------------------------------------------------------------------------------ |
| `off`   | The default. Nothing is read, classified, listed or sent. The Decision inbox is hidden.    |
| `inbox` | Idle chats are classified and listed in the Decision inbox. No chat is ever sent anything. |
| `wake`  | As `inbox`, and a chat judged stalled is sent a wake message.                              |

Each idle ending gets one of three verdicts:

- `finished`: nothing to do. Recorded, not shown.
- `waiting_user`: the agent asked you something. Listed with the question.
- `stalled`: the agent offered or promised work it could do now and did not do it. Listed, and
  woken in mode `wake`.

Without a classifier command of your own (see below) a built-in check runs. It only looks at how
the last message closes, lists it as `waiting_user` when it closes on a question, and never says
`stalled`. So mode `wake` wakes nothing until you set a classifier command.

## Which chats are looked at

Native chats and terminal agents on this host whose turn ended and that have been idle for
`forkIdleSweepIdleSeconds`. Never: a chat in a turn, a turn you stopped yourself, sub-agents,
sleeping or hibernated chats, and orchestration workers (unless `forkIdleSweepWorkers` is
`include`).

Each ending is classified once. It is classified again only when the chat went idle anew with a
different ending, or when the classifier asked for a later look.

## When a wake is sent, and when it is not

A wake is a message typed into the chat for you, so the rules are strict. A stalled chat is woken
only when all of these hold:

- The mode is `wake` and a classifier command of yours said `stalled` with a `next_step`.
- The turn that ended was one you asked for, or an earlier wake of it. Turns started by
  orchestration or an automation are never woken.
- The chat has had fewer than `forkIdleSweepMaxWakes` wakes in a row. A turn you start yourself
  gives the wakes back. The count survives an app restart.
- The chat is not paused.
- The chat has no background job pending and no scheduled wake-up of its own, and is not a
  coordinator still waiting on its workers. The wake is held and asked again on each sweep.
- A native chat: its agent is loaded and not in a turn. The message is queued as your message
  would be, and a draft in the composer is not touched.
- A terminal agent: the terminal is live, the agent (not a shell) is the program reading it, no
  turn runs, no dialog or prompt is up, and the composer on screen is empty. All of it is checked
  again right before the first key is written. Text you typed and did not send is never
  submitted with a wake. A terminal that cannot be read is not woken.
- A terminal agent, also: you have not typed into that terminal since the turn ended. The app
  recognises the composer of only some agents on screen, so for the rest your keys are the only
  sign of a draft. Once you touch the terminal it is yours until the agent's next turn ends.

A wake that could not be sent is tried again later. A send that failed after it may have arrived
counts as sent, so a wake is never sent twice. At the cap, or when a wake is not allowed, the
chat stays in the inbox as stalled for you to deal with.

## The Decision inbox

A sidebar toolbar button with a count, a dialog, and command palette entries. All of them are
absent while the mode is `off`.

- Each row shows the question (or why the chat is stalled), how long ago, and the wakes so far.
- **Answer box.** What you type is sent to the chat as your own message and clears the row. On a
  stalled row it tells the agent how to go on.
- **Go to chat** opens the chat or the terminal pane.
- **Pause recovery** leaves one chat alone: it is not classified, not woken and not notified
  about. A row that was already listed stays, frozen, under Paused, and is not counted on the
  button. Resume from the row, from Settings, or with `orca inbox pause <id> --resume`.

From a terminal, on any paired host:

```sh
orca inbox list [--json]
orca inbox answer <id> <text>
orca inbox pause <id> [--resume]
```

Ids may be given by prefix.

## Settings

| Setting                                 | Default | What it is                                                                     |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `forkIdleSweepMode`                     | `off`   | `off`, `inbox` or `wake`.                                                      |
| `forkIdleSweepIdleSeconds`              | 45      | How long a chat must sit idle after its turn ended before it is looked at.     |
| `forkIdleSweepClassifierCommand`        | empty   | Your classifier command. Empty uses the built-in check.                        |
| `forkIdleSweepClassifierTimeoutSeconds` | 30      | The classifier is stopped after this long, and the ending reads as `finished`. |
| `forkIdleSweepMaxWakes`                 | 2       | Wakes in a row for one chat before it is left for you.                         |
| `forkIdleSweepRecheckMaxMinutes`        | 60      | The longest delay a classifier may ask for with `wake_after_seconds`.          |
| `forkIdleSweepWorkers`                  | `skip`  | `include` also looks at orchestration workers.                                 |
| `forkIdleSweepPaused`                   | empty   | The paused chats. Written by Pause recovery.                                   |
| `forkInboxNotifyDesktop`                | off     | A desktop notification when a chat starts waiting on you.                      |
| `forkInboxNotifyWebhookUrl`             | empty   | An address that gets a POST of the new items as JSON.                          |
| `forkInboxNotifyCommand`                | empty   | A command that gets the same JSON on stdin.                                    |

Each chat is notified about once per ending. A failing target stops nothing else.

`orca settings` can change the mode and the limits, so an agent can too. It cannot write the
classifier command, the notification command or the webhook address: those start a program or
call an address, and are set in the Settings screen only. Turning the mode on from the CLI
therefore runs only the commands you already put there.

## The classifier contract

The classifier is any command. It is run through your shell once per ending, at most three at a
time, with one JSON object on stdin:

```json
{
  "version": 1,
  "chat": { "id": "...", "kind": "chat", "agent": "claude", "cwd": "/path", "title": "..." },
  "request_source": "user",
  "role": "standalone",
  "last_user_request": "...",
  "last_assistant_message": "...",
  "idle_seconds": 52,
  "background_pending": false,
  "scheduled_wake": false,
  "wakes_this_turn": 0,
  "max_wakes": 2
}
```

| Field                    | What it is                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| `version`                | Always 1 for this contract. Answer `finished` for a version you do not know. |
| `chat.kind`              | `chat` (a native chat) or `terminal` (an agent in a terminal pane).          |
| `request_source`         | Who asked for the turn: `user`, `orchestration`, `automation` or `wake`.     |
| `role`                   | `standalone`, `worker` or `coordinator`.                                     |
| `last_user_request`      | The prompt of the turn that ended.                                           |
| `last_assistant_message` | The end of the agent's last message, at most 8000 characters.                |
| `idle_seconds`           | How long the chat has been idle.                                             |
| `background_pending`     | The chat has a background job that will report back.                         |
| `scheduled_wake`         | The chat has a wake-up of its own scheduled.                                 |
| `wakes_this_turn`        | Wakes already sent since your last prompt.                                   |
| `max_wakes`              | The `forkIdleSweepMaxWakes` setting.                                         |

It prints one JSON object on stdout, with every field present:

```json
{
  "verdict": "stalled",
  "reason": "promised to run the tests and stopped",
  "question": "",
  "next_step": "Run the tests now and report the result.",
  "wake_after_seconds": 0
}
```

| Field                | What it is                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| `verdict`            | `finished`, `waiting_user` or `stalled`.                                        |
| `reason`             | One line, shown in the inbox for a stalled chat.                                |
| `question`           | For `waiting_user`: what you are asked. Else `""`.                              |
| `next_step`          | For `stalled`: the body of the wake message. Else `""`.                         |
| `wake_after_seconds` | 0 for now. More than 0 delays the wake, or asks for a second look at that time. |

**Failure means no wake.** A command that does not start, exits non-zero, runs past the timeout,
or prints anything but one such JSON object reads as `finished`. A broken classifier never wakes a
chat and never fills the inbox.

## The wake message, and telling it from your own turn

Every wake starts with this exact line, followed by the classifier's `next_step`:

```
[idle-recovery: automatic wake]
Run the tests now and report the result.
```

To the agent a wake is an ordinary user prompt. If your agent has hooks of its own, that first
line is the only way they can tell a wake from you:

- A prompt hook (one that receives the submitted prompt) can test whether the prompt starts with
  `[idle-recovery: automatic wake]`.
- A Stop hook usually does not receive the prompt. Have the prompt hook leave a note for the
  session (a small file keyed by the session id), or have the Stop hook read the last user
  message from the transcript, and test the same first line. A Stop hook that nags the agent to
  continue should skip turns started by a wake, or the two will take turns prodding the chat.

The classifier sees the same fact as `request_source: "wake"`.

## The example classifier

`docs/fork/idle-recovery/example-classifier.mjs` is a small script with no dependencies and no
model. It needs only Node. Set the classifier command to:

```sh
node "/path/to/docs/fork/idle-recovery/example-classifier.mjs"
```

Its rules are deliberately cautious:

- The closing lines end in a question, or ask you to choose or confirm: `waiting_user`.
- The closing lines promise work in the first person ("I will run the tests next") and name
  nothing the agent waits for (you, an approval, a login, something it cannot do), in a turn you
  asked for: `stalled`, with a `next_step` that quotes the promise back.
- A background job is pending: `finished`, with a second look in two minutes.
- Anything else, and anything it cannot read: `finished`.

It reads English phrasing only. Copy it and change the word lists at the top to fit how your
agents write. Try it by hand:

```sh
echo '{"version":1,"request_source":"user","last_assistant_message":"I will run the tests next."}' \
  | node docs/fork/idle-recovery/example-classifier.mjs
```

## A model-backed classifier

Rules miss a lot. A model reads an ending far better, and the contract is the same: any command
that reads the JSON on stdin and prints a verdict on stdout. A wrapper script usually does three
things:

1. Read stdin and build a prompt from `last_user_request`, `last_assistant_message` and the
   flags. Ask for exactly the five output fields as JSON and nothing else.
2. Send it to a model, local or hosted, with whatever client you already use. Keep it well under
   `forkIdleSweepClassifierTimeoutSeconds`.
3. Print the model's JSON. On any error print nothing and exit non-zero: that reads as
   `finished`.

Things worth telling the model: say `stalled` only when the agent could do the work right now
with no input from you. A summary followed by an offer ("want me to...") is `waiting_user`. When
in doubt, `finished`. Write `next_step` as a plain instruction to the agent.

The command runs with your account's rights and sees the end of your chats, so point it only at
a model you are willing to send that text to.

## Limits so far

- A native chat's own scheduled wake-ups are not visible to idle recovery, so `scheduled_wake`
  is always false for native chats. A chat that planned to wake itself may be woken first.
- A native chat whose agent is not loaded (after a restart, until you open it) is never listed
  and never woken.
- Stopping a classifier that ran past its timeout is untested on Windows.
- A draft typed into a terminal while the agent was still working is seen only when the app
  recognises that agent's composer on screen. For other agents such a draft can end up in front
  of a wake.
- A paused row stays as it was until you resume it, even if the chat has moved on or is gone.
- After a wake, an agent that ends its next turn with the very same words is not classified
  again.
