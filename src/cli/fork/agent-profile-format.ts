// FORK.md "Agent profiles": how `orca profiles list` and `show` print a profile row.
import type { ForkAgentProfile } from '../../shared/fork/agent-profiles/agent-profiles-types'
import type {
  ForkAgentProfileRow,
  ForkAgentProfilesListResult
} from '../../shared/fork/agent-profiles/agent-profiles-wire'

function fields(row: ForkAgentProfileRow): string {
  return [
    `agent ${row.agent}`,
    row.model ? `model ${row.model}` : null,
    row.effort ? `effort ${row.effort}` : null,
    row.permissionMode ? `permission ${row.permissionMode}` : null,
    row.mcpProfile ? `mcp ${row.mcpProfile}` : null,
    row.account ? `account ${row.account}` : null
  ]
    .filter(Boolean)
    .join(', ')
}

/** BAD-817: the definition's limits the profile does not carry. */
export function forkAgentProfileNotKept(profile: ForkAgentProfile): string[] {
  return profile.imported?.notKept ?? []
}

export function formatForkAgentProfiles(result: ForkAgentProfilesListResult): string {
  if (result.profiles.length === 0) {
    return 'No agent profiles. Make one with `orca profiles set <name> --agent <agent> ...` or `orca profiles import`.'
  }
  return result.profiles
    .map((row) =>
      [
        `${row.name}: ${fields(row)}${row.needsConfirm ? ' [imported: confirm before use]' : ''}`,
        ...(row.whenToUse ? [`  when to use: ${row.whenToUse}`] : []),
        ...(forkAgentProfileNotKept(row).length > 0
          ? [`  not kept: ${forkAgentProfileNotKept(row).join('; ')}`]
          : [])
      ].join('\n')
    )
    .join('\n')
}

export function formatForkAgentProfile(row: ForkAgentProfileRow): string {
  return [
    `name: ${row.name}`,
    ...fields(row)
      .split(', ')
      .map((part) => part.replace(' ', ': ')),
    `max permission: ${row.maxPermission}`,
    ...(row.whenToUse ? [`when to use: ${row.whenToUse}`] : []),
    ...(row.imported
      ? [
          `imported from: ${row.imported.path}`,
          ...forkAgentProfileNotKept(row).map((line) => `not kept: ${line}`),
          `confirmed: ${row.needsConfirm ? `no (run \`orca profiles confirm ${row.name}\`)` : 'yes'}`
        ]
      : []),
    ...(row.preamble ? ['preamble:', row.preamble] : [])
  ].join('\n')
}
