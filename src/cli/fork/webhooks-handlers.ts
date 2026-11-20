// SLRM-2271 (FORK.md "Webhook automations"): `orca webhooks`, through the fork.webhooks.* RPCs.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  parseForkWebhookCondition,
  type ForkWebhookCondition,
  type ForkWebhookListResult,
  type ForkWebhookRemoveResult,
  type ForkWebhookSecretResult
} from '../../shared/fork/webhooks'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no webhooks. It needs a Blackfish build with SLRM-2271.'
    )
  }
  throw error
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function conditions(value: string | undefined): ForkWebhookCondition[] {
  return list(value).map((text) => {
    const condition = parseForkWebhookCondition(text)
    if (!condition) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--when takes path=value pairs with a dotted path, like workflow_run.conclusion=failure; got "${text}".`
      )
    }
    return condition
  })
}

export function formatWebhookList(result: ForkWebhookListResult): string {
  const state = !result.enabled
    ? 'Webhooks are off on this host (forkWebhooks.enabled).'
    : result.listening
      ? `Listening on ${result.listening}.`
      : `Not listening${result.error ? `: ${result.error}` : '.'}`
  const lines = [state]
  if (result.hooks.length === 0) {
    lines.push('No webhooks. Add one with `orca webhooks add`.')
  }
  for (const hook of result.hooks) {
    const filters = [
      hook.events.length > 0 ? `events ${hook.events.join(',')}` : '',
      ...hook.when.map((entry) => `${entry.path}=${entry.value}`)
    ].filter(Boolean)
    lines.push(
      '',
      `${hook.name}  (${hook.id})`,
      `  automation: ${hook.automationName ?? 'missing'} (${hook.automationId})`,
      `  url: ${hook.url}`,
      `  filters: ${filters.length > 0 ? filters.join('; ') : 'none'}`,
      `  last delivery: ${hook.lastDelivery ? `${new Date(hook.lastDelivery.at).toISOString()} ${hook.lastDelivery.result}` : 'none since start'}`
    )
  }
  return lines.join('\n')
}

function formatSecret(result: ForkWebhookSecretResult): string {
  return [
    `${result.name} (${result.id})`,
    `URL: ${result.url}`,
    `Secret: ${result.secret}`,
    'The secret is shown only now. Put it in the sender (GitHub: the webhook secret, content type application/json).'
  ].join('\n')
}

async function secretCall(ctx: HandlerContext, method: string, params: unknown): Promise<void> {
  const result = await ctx.client.call<ForkWebhookSecretResult>(method, params).catch(incompatible)
  printResult(result, ctx.json, formatSecret)
}

export const FORK_WEBHOOK_HANDLERS: Record<string, CommandHandler> = {
  'webhooks list': async (ctx) => {
    // SLRM-2445: upstream 1.4.266 lists a bot's webhooks here too; --bot keeps its list.
    if (ctx.flags.has('bot')) {
      const { WEBHOOK_HANDLERS } = await import('../webhooks/webhooks.js')
      return WEBHOOK_HANDLERS['webhooks list'](ctx)
    }
    const result = await ctx.client
      .call<ForkWebhookListResult>('fork.webhooks.list', {})
      .catch(incompatible)
    printResult(result, ctx.json, formatWebhookList)
  },
  'webhooks add': (ctx) =>
    secretCall(ctx, 'fork.webhooks.add', {
      name: getRequiredStringFlag(ctx.flags, 'name'),
      automationId: getRequiredStringFlag(ctx.flags, 'automation'),
      events: list(getOptionalStringFlag(ctx.flags, 'event')),
      when: conditions(getOptionalStringFlag(ctx.flags, 'when'))
    }),
  'webhooks rotate': (ctx) =>
    secretCall(ctx, 'fork.webhooks.rotate', { target: getRequiredStringFlag(ctx.flags, 'target') }),
  'webhooks remove': async (ctx) => {
    const result = await ctx.client
      .call<ForkWebhookRemoveResult>('fork.webhooks.remove', {
        target: getRequiredStringFlag(ctx.flags, 'target')
      })
      .catch(incompatible)
    printResult(result, ctx.json, (r) => `${r.name} (${r.id}): removed`)
  }
}
