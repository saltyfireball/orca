// FORK.md "MCP profiles": the list of named profiles in Settings. Each is an allow
// list (only these servers) or a deny list (every server but these).
import { useState } from 'react'
import {
  FORK_MCP_MAX_PROFILES,
  isForkMcpBuiltInProfile,
  isForkMcpProfileName,
  type ForkMcpProfile
} from '../../../../shared/fork/mcp-profiles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  profiles: ForkMcpProfile[]
  /** Servers found in Claude's config, offered as quick picks. */
  known: string[]
  onChange: (next: ForkMcpProfile[]) => void
}

function splitServers(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )
}

function freeName(profiles: ForkMcpProfile[]): string {
  for (let index = 1; ; index += 1) {
    const name = `profile-${index}`
    if (!profiles.some((profile) => profile.name === name)) {
      return name
    }
  }
}

function ProfileRow(props: {
  profile: ForkMcpProfile
  taken: (name: string) => boolean
  known: string[]
  onChange: (next: ForkMcpProfile) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { profile } = props
  const [name, setName] = useState<string | null>(null)
  const [servers, setServers] = useState<string | null>(null)
  const commitName = (): void => {
    const next = (name ?? profile.name).trim()
    setName(null)
    if (next !== profile.name && isForkMcpProfileName(next) && !isForkMcpBuiltInProfile(next)) {
      if (!props.taken(next)) {
        props.onChange({ ...profile, name: next })
      }
    }
  }
  const commitServers = (): void => {
    if (servers !== null) {
      props.onChange({ ...profile, servers: splitServers(servers) })
    }
    setServers(null)
  }
  const missing = props.known.filter((server) => !profile.servers.includes(server))
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          className="w-48"
          aria-label={t('fork.mcpProfiles.editor.name', 'Profile name')}
          value={name ?? profile.name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
        <select
          aria-label={t('fork.mcpProfiles.editor.mode', 'Profile kind')}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={profile.mode}
          onChange={(event) =>
            props.onChange({ ...profile, mode: event.target.value === 'deny' ? 'deny' : 'allow' })
          }
        >
          <option value="allow">{t('fork.mcpProfiles.editor.allow', 'Only these servers')}</option>
          <option value="deny">
            {t('fork.mcpProfiles.editor.deny', 'Every server but these')}
          </option>
        </select>
        <Button size="sm" variant="outline" onClick={props.onRemove}>
          {t('fork.mcpProfiles.editor.remove', 'Remove')}
        </Button>
      </div>
      <Input
        aria-label={t('fork.mcpProfiles.editor.servers', 'Server names')}
        placeholder={t('fork.mcpProfiles.editor.serversHint', 'Server names, comma separated')}
        value={servers ?? profile.servers.join(', ')}
        onChange={(event) => setServers(event.target.value)}
        onBlur={commitServers}
      />
      {missing.length ? (
        <div className="flex flex-wrap gap-1">
          {missing.map((server) => (
            <Button
              key={server}
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => props.onChange({ ...profile, servers: [...profile.servers, server] })}
            >
              + {server}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ForkMcpProfileEditor({ profiles, known, onChange }: Props): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="space-y-2">
      {profiles.map((profile, index) => (
        <ProfileRow
          key={`${index}:${profile.name}`}
          profile={profile}
          known={known}
          taken={(name) => profiles.some((other, at) => at !== index && other.name === name)}
          onChange={(next) => onChange(profiles.map((p, at) => (at === index ? next : p)))}
          onRemove={() => onChange(profiles.filter((_, at) => at !== index))}
        />
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={profiles.length >= FORK_MCP_MAX_PROFILES}
        onClick={() =>
          onChange([...profiles, { name: freeName(profiles), mode: 'allow', servers: [] }])
        }
      >
        {t('fork.mcpProfiles.editor.add', 'Add profile')}
      </Button>
    </div>
  )
}
