// SLRM-2271 (FORK.md "Webhook automations"): `orca webhooks` and the Settings card. host-admin:
// a webhook opens a way in from the network, like the other host-level switches.
import { defineMethod } from '../../core'
import {
  ForkWebhookAddParams,
  ForkWebhookListParams,
  ForkWebhookTargetParams
} from '../../../../../shared/fork/webhooks'
import {
  addForkWebhook,
  listForkWebhooks,
  removeForkWebhook,
  rotateForkWebhook
} from '../../../../fork/webhooks/webhook-service'

export const FORK_WEBHOOK_METHODS = [
  defineMethod({
    name: 'fork.webhooks.list',
    permission: 'host-admin',
    params: ForkWebhookListParams,
    handler: async () => listForkWebhooks()
  }),
  defineMethod({
    name: 'fork.webhooks.add',
    permission: 'host-admin',
    params: ForkWebhookAddParams,
    handler: async (params) => addForkWebhook(params)
  }),
  defineMethod({
    name: 'fork.webhooks.rotate',
    permission: 'host-admin',
    params: ForkWebhookTargetParams,
    handler: async (params) => rotateForkWebhook(params.target)
  }),
  defineMethod({
    name: 'fork.webhooks.remove',
    permission: 'host-admin',
    params: ForkWebhookTargetParams,
    handler: async (params) => removeForkWebhook(params.target)
  })
] as const
