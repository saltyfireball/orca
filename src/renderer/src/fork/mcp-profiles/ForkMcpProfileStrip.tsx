// FORK.md "MCP profiles": a Claude chat's MCP profile, in the chat's status area.
// Shown once any profile setting is in use. Choosing another profile applies at the chat's next
// start; a new chat that has not sent its first message starts with it.
import {
  FORK_MCP_PROFILE_ALL,
  FORK_MCP_PROFILE_NONE,
  forkMcpProfileConfigOf,
  forkMcpProfilesInUse,
  type ForkMcpChatInfo
} from '../../../../shared/fork/mcp-profiles'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { useForkMcpChat } from './use-fork-mcp-chat'

const DEFAULT_VALUE = ''

function serversText(t: Translate, chat: ForkMcpChatInfo): string {
  const last = chat.last
  if (!last) {
    return t('fork.mcpProfiles.strip.notStarted', 'Not started with a profile yet.')
  }
  if (!last.applied) {
    return last.skipped
      ? t('fork.mcpProfiles.strip.skipped', 'Running with every server: {{reason}}', {
          reason: last.skipped
        })
      : t('fork.mcpProfiles.strip.every', 'Running with every server.')
  }
  return last.servers.length
    ? t('fork.mcpProfiles.strip.servers', 'Running with: {{servers}}', {
        servers: last.servers.join(', ')
      })
    : t('fork.mcpProfiles.strip.noServers', 'Running with no MCP servers.')
}

export function ForkMcpProfileStrip({
  sessionId
}: {
  sessionId: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const settings = useAppStore((s) => s.settings)
  const { chat, choose } = useForkMcpChat(sessionId)
  const config = forkMcpProfileConfigOf(settings ?? {})
  if (!chat || !chat.supported) {
    return null
  }
  if (!forkMcpProfilesInUse(config) && !chat.chosen && !chat.last?.applied) {
    return null
  }
  const running = chat.last?.profile ?? chat.next.profile
  const names = [FORK_MCP_PROFILE_ALL, FORK_MCP_PROFILE_NONE, ...config.profiles.map((p) => p.name)]
  const label = t('fork.mcpProfiles.strip.label', 'MCP profile')
  return (
    <div
      className="mx-3 mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      title={serversText(t, chat)}
    >
      <span>
        {label}: <span className="font-medium text-foreground">{running}</span>
      </span>
      <select
        aria-label={label}
        className="h-6 rounded border border-border bg-background px-1 text-xs"
        value={chat.chosen ?? DEFAULT_VALUE}
        onChange={(event) =>
          choose(event.target.value === DEFAULT_VALUE ? null : event.target.value)
        }
      >
        <option value={DEFAULT_VALUE}>
          {chat.chosen
            ? t('fork.mcpProfiles.strip.defaultPlain', 'Default')
            : t('fork.mcpProfiles.strip.default', 'Default ({{profile}})', {
                profile: chat.next.profile
              })}
        </option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {chat.changePending ? (
        <span>
          {t(
            'fork.mcpProfiles.strip.pending',
            'Switches to {{profile}} when this chat next starts.',
            { profile: chat.next.profile }
          )}
        </span>
      ) : null}
      {chat.last?.skipped ? (
        <span className="text-amber-600 dark:text-amber-400">
          {t('fork.mcpProfiles.strip.notApplied', 'Profile not applied')}
        </span>
      ) : null}
    </div>
  )
}
