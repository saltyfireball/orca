// FORK.md "MCP profiles": plain-text output for `orca mcp-profile`.
import type {
  ForkMcpChatInfo,
  ForkMcpListing,
  ForkMcpProfileChoice
} from '../../shared/fork/mcp-profiles'

const SOURCE_TEXT: Record<ForkMcpProfileChoice['source'], string> = {
  chat: "the chat's own choice",
  project: 'the project default',
  kind: 'the launch default'
}

export function formatMcpListing(listing: ForkMcpListing): string {
  const lines: string[] = [
    listing.folder ? `MCP servers for ${listing.folder}:` : 'MCP servers (user scope):'
  ]
  if (listing.servers.length === 0) {
    lines.push('  none found')
  }
  for (const server of listing.servers) {
    const command = server.command ? `  ${server.command}` : ''
    lines.push(
      `  ${server.name.padEnd(24)} ${server.scope.padEnd(7)} ${server.status.padEnd(10)} ${server.transport}${command}`
    )
  }
  lines.push('', 'Profiles:', '  all  (built in: every server)', '  none (built in: no servers)')
  for (const profile of listing.profiles) {
    const servers = profile.servers.length ? profile.servers.join(', ') : '(no servers listed)'
    const verb = profile.mode === 'allow' ? 'only' : 'all but'
    lines.push(`  ${profile.name}: ${verb} ${servers}`)
  }
  lines.push(
    '',
    `Defaults: chats ${listing.defaults.interactive}, workers ${listing.defaults.worker}, background runs ${listing.defaults.background}`
  )
  for (const project of listing.projects) {
    lines.push(`  ${project.path}: ${project.profile}`)
  }
  if (listing.notes.length) {
    lines.push('', ...listing.notes.map((note) => `note: ${note}`))
  }
  return lines.join('\n')
}

export function formatMcpChat(value: { chat: ForkMcpChatInfo | null }): string {
  const chat = value.chat
  if (!chat) {
    return 'This host does not keep MCP profiles for chats.'
  }
  if (!chat.supported) {
    return `MCP profiles apply to Claude chats only; this chat runs ${chat.provider ?? 'an unknown agent'}.`
  }
  const lines = [`next start: ${chat.next.profile} (${SOURCE_TEXT[chat.next.source]})`]
  const last = chat.last
  if (!last) {
    lines.push('last start: not started with profiles yet')
  } else if (last.applied) {
    const servers = last.servers.length ? last.servers.join(', ') : 'no servers'
    lines.push(`last start: ${last.profile}, with ${servers}`)
  } else {
    lines.push(`last start: every server${last.skipped ? ` (${last.skipped})` : ''}`)
  }
  if (chat.changePending) {
    lines.push('The change applies when the chat next starts.')
  }
  return lines.join('\n')
}
