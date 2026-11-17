// SLRM-2271 (FORK.md "Webhook automations"): `orca webhooks`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Webhooks belong to the host that runs the automation; --environment <name> manages a paired server.'

export const FORK_WEBHOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['webhooks', 'list'],
    summary: 'List webhooks, the automation each starts and its last delivery',
    usage: 'orca webhooks list [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Webhooks are off by default. Turn the listener on with `orca settings set forkWebhooks \'{"enabled":true}\'`; it binds 127.0.0.1:47390 unless forkWebhooks.bindHost and forkWebhooks.port say otherwise. Bind an address the sender can reach (a Tailscale address, or a reverse proxy in front).',
      'Secrets are never listed; `orca webhooks rotate` makes a new one.',
      HOST_NOTE
    ],
    examples: ['orca webhooks list']
  },
  {
    path: ['webhooks', 'add'],
    summary: 'Add a webhook that starts an automation run, and print its URL and secret once',
    usage:
      'orca webhooks add --name <name> --automation <id> [--event <a,b>] [--when <path=value,...>] [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'automation', 'event', 'when'],
    notes: [
      'The sender signs each request body with HMAC-SHA256 under the secret and sends `sha256=<hex>` in X-Hub-Signature-256 (GitHub does this when the webhook has a secret) or X-Blackfish-Signature-256. Unsigned or wrongly signed requests are refused.',
      '--event keeps only deliveries whose X-GitHub-Event (or X-GitLab-Event, X-Blackfish-Event) header is one of the names. --when keeps only JSON payloads where each dotted path holds the value.',
      'The payload is added to the automation prompt inside a block marked untrusted, cut at forkWebhooks.payloadMaxChars. The run starts whether or not the automation schedule is paused.',
      HOST_NOTE
    ],
    examples: [
      'orca webhooks add --name ci-failed --automation 7c1e --event workflow_run --when workflow_run.conclusion=failure',
      'orca webhooks add --name deploy --automation 7c1e'
    ]
  },
  {
    path: ['webhooks', 'rotate'],
    summary: 'Give a webhook a new secret and print it once; the old one stops working',
    usage: 'orca webhooks rotate <webhook> [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: ['A webhook is its id, a unique id prefix, or its name.', HOST_NOTE],
    examples: ['orca webhooks rotate ci-failed']
  },
  {
    path: ['webhooks', 'remove'],
    summary: 'Remove a webhook; its URL stops accepting deliveries at once',
    usage: 'orca webhooks remove <webhook> [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target'],
    positionalArgs: ['target'],
    notes: ['A webhook is its id, a unique id prefix, or its name.', HOST_NOTE],
    examples: ['orca webhooks remove ci-failed']
  }
]
