// Endpoint failover (SLRM-2267, FORK.md): the Remote servers section of the fork's Settings pane,
// its title, description and search entry. Kept apart from fork-settings-pane-catalog.ts, which
// spreads it. The entry title is the card's own heading text (ForkEndpointFailoverSetting.tsx).
import type { SettingsSearchEntry } from '@/components/settings/search/settings-search'
import type { Translate } from '@/i18n/use-translate'

export function getForkRemoteSettingsSectionParts(
  t: Translate
): [title: string, description: string, entries: SettingsSearchEntry[]] {
  return [
    t('fork.settingsPane.remote.title', 'Remote servers'),
    t(
      'fork.settingsPane.remote.description',
      'How this desktop reaches and watches the remote servers it is paired with, its heartbeat, which devices may pair with it, and webhooks it accepts.'
    ),
    [
      {
        title: t('fork.endpointFailover.title', 'Server routes'),
        description: t(
          'fork.settingsPane.search.endpointFailover',
          'Use another address of a remote server when one stops answering, and move back.'
        ),
        keywords: [
          'remote',
          'server',
          'failover',
          'fallback',
          'lan',
          'tailscale',
          'address',
          'endpoint',
          'forkEndpointFailover'
        ]
      },
      // SLRM-2311: the Server health and Heartbeat cards (their headings).
      {
        title: t('fork.serverHealth.title', 'Server health'),
        description: t(
          'fork.settingsPane.search.serverHealth',
          'Alert when a paired server stops answering and when it is back.'
        ),
        keywords: ['offline', 'down', 'outage', 'alert', 'monitor', 'forkServerHealth']
      },
      {
        title: t('fork.serverHeartbeat.title', 'Heartbeat'),
        description: t(
          'fork.settingsPane.search.serverHeartbeat',
          'Call a monitor address every few seconds so it notices when this host stops.'
        ),
        keywords: ['heartbeat', 'healthchecks', 'uptime', 'ping', 'forkServerHeartbeatUrl']
      },
      // SLRM-2271: the Device approval and Webhooks cards (their headings).
      {
        title: t('fork.deviceApproval.title', 'Device approval'),
        description: t(
          'fork.settingsPane.search.deviceApproval',
          'A newly paired device waits until an approved device or this host approves it.'
        ),
        keywords: ['pairing', 'pair', 'approve', 'device', 'phone', 'revoke', 'forkDeviceApproval']
      },
      {
        title: t('fork.webhooks.title', 'Webhooks'),
        description: t(
          'fork.settingsPane.search.webhooks',
          'Start an automation when a signed webhook arrives, such as a failed CI run.'
        ),
        keywords: ['webhook', 'automation', 'ci', 'github', 'trigger', 'forkWebhooks']
      }
    ]
  ]
}
