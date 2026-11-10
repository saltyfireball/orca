// SLRM-1966: a sidebar agent row wears its tab's color dot as a soft tint and a left edge bar,
// so a row and its tab strip tab read as one. The color is the tab's own `color`, the exact
// field SortableTab paints as the dot after the title, so the two always agree and clear together.
import type { CSSProperties } from 'react'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'

/** Alpha of the row tint, as two hex digits (0x24 = about 14%). */
export const ROW_TINT_ALPHA_HEX = '24'

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export type AgentRowTabColorInput = {
  worktreeId: string
  tabId: string
  paneKey: string
  tabsByWorktree: Record<string, TerminalTab[] | undefined> | undefined
  unifiedTabsByWorktree: Record<string, Tab[] | undefined> | undefined
}

/**
 * The color the tab strip shows for this row's tab, or null when that tab shows no dot.
 * A native chat tab is the agent-session unified tab whose pane key is the row's (TabBarItemRow
 * paints `item.data.color`); a terminal pane's tab is the terminal tab (TerminalSortableTab
 * paints `TerminalTab.color`).
 *
 * The chat lookup is keyed by the pane key alone, never by `entry.structuredHostOwned`: that flag
 * only means "this host has the provider child running right now" and drops as soon as a chat
 * finishes and its child is released, so a done or idle chat would fall through to the terminal
 * tabs, where a chat-only workspace has none.
 */
export function resolveAgentRowTabColor({
  worktreeId,
  tabId,
  paneKey,
  tabsByWorktree,
  unifiedTabsByWorktree
}: AgentRowTabColorInput): string | null {
  const chat = (unifiedTabsByWorktree?.[worktreeId] ?? []).find(
    (tab) =>
      tab.contentType === 'agent-session' &&
      // Cheap prefix check first, so only the row's own tab is hashed.
      paneKey.startsWith(`${tab.id}:`) &&
      structuredAgentSessionPaneKey(tab.id, tab.entityId) === paneKey
  )
  if (chat) {
    return chat.color || null
  }
  const terminal = (tabsByWorktree?.[worktreeId] ?? []).find((tab) => tab.id === tabId)
  return terminal?.color || null
}

/** Expand `#rgb` to `#rrggbb`; anything that is not a hex color comes back null. */
export function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color || !HEX_COLOR_RE.test(color)) {
    return null
  }
  const hex = color.slice(1).toLowerCase()
  return hex.length === 3
    ? `#${hex
        .split('')
        .map((c) => c + c)
        .join('')}`
    : `#${hex}`
}

/**
 * The overlay style for a tab color: a low-alpha wash of that color and a 2px left bar in the
 * full color. No color (or one that is not hex, which the palette never writes) leaves the row
 * plain.
 */
export function agentRowTintStyle(color: string | null | undefined): CSSProperties | null {
  const hex = normalizeHexColor(color)
  if (!hex) {
    return null
  }
  return {
    backgroundColor: `${hex}${ROW_TINT_ALPHA_HEX}`,
    boxShadow: `inset 2px 0 0 ${hex}`
  }
}

/**
 * The collapsed icon strip's ring for a tab color: a thin full-color ring drawn over the icon's
 * own border. Same resolver and hex check as the row tint, so the two always agree.
 */
export function agentIconRingStyle(color: string | null | undefined): CSSProperties | null {
  const hex = normalizeHexColor(color)
  if (!hex) {
    return null
  }
  return { boxShadow: `inset 0 0 0 1.5px ${hex}` }
}
