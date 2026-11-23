// Fork BAD-747: "Open in terminal" for an owner step. A terminal opens on the step's computer (this one,
// or a paired or SSH host Orca knows by name) in a workspace there, with the command typed in and NOT
// run: the owner presses Enter. A step naming no computer opens in the bot's own workspace.
import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useRuntimeStatusByEnvironmentId } from '@/store/slices/runtime-status/views/use-runtime-status-view'
import { buildSidebarHostOptions } from '@/components/sidebar/worktree-list/controls/sidebar-host-options'
import { translateHostDisplayLabel } from '@/runtime/hosts/display/execution-host-label'
import { getPaletteWorktreeExecutionHostId } from '@/lib/workspace/search/palette-repo-resolution'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { runQuickCommandInNewTab } from '@/lib/terminal/quick-commands/run-quick-command-in-new-tab'
import { getHostDisplayLabelOverrides } from '../../../../shared/execution-host/host-setting-overrides'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import type { Bot } from '../../../../shared/bot-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  botItemStepTyping,
  matchBotItemStepHost
} from '../../../../shared/bots/bot-item-step-terminal'
import { readForkBotOwnerStepsOpenInTerminal } from '../../../../shared/fork/bot-owner-steps'
import type { BotItemStep } from '../../../../shared/bots/bot-item-steps'

export type BotStepTerminal =
  /** `why`: what the button's tooltip says when it is off. */
  | { canOpen: false; why: 'off' | 'none' | 'unsafe' | 'multiline' | 'unknown-host' }
  | { canOpen: true; open: () => void }

const MAX_LABEL = 40

export function useBotStepTerminal(bot: Bot): (step: BotItemStep) => BotStepTerminal {
  const settings = useAppStore((s) => s.settings)
  const repos = useAppStore((s) => s.repos)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useRuntimeStatusByEnvironmentId()
  const worktreesByRepo = useAppStore((s) => selectWorktreesByRepo(s))
  const enabled = readForkBotOwnerStepsOpenInTerminal(settings)
  const hosts = useMemo(
    () =>
      buildSidebarHostOptions({
        repos,
        sshTargetLabels,
        sshConnectionStates,
        settings,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides: getHostDisplayLabelOverrides(settings)
      }).map((host) => ({ id: host.id, label: translateHostDisplayLabel(host) })),
    [
      repos,
      sshTargetLabels,
      sshConnectionStates,
      settings,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )
  const thisComputer = settings?.machineName?.trim() ?? ''
  const botWorkspace = bot.folderWorkspaceId ? folderWorkspaceKey(bot.folderWorkspaceId) : null

  /** A workspace on `hostId`, or the bot's own when no host is named. */
  const workspaceOn = useCallback(
    (hostId: ExecutionHostId | null): { worktreeId: string; hostId?: ExecutionHostId } | null => {
      if (hostId === null) {
        return botWorkspace ? { worktreeId: botWorkspace } : null
      }
      const found = Object.values(worktreesByRepo)
        .flat()
        .find((worktree) => getPaletteWorktreeExecutionHostId(worktree) === hostId)
      return found ? { worktreeId: found.id, hostId } : null
    },
    [botWorkspace, worktreesByRepo]
  )

  return useCallback(
    (step: BotItemStep): BotStepTerminal => {
      if (!enabled) {
        return { canOpen: false, why: 'off' }
      }
      const typing = botItemStepTyping(step.command)
      if (!typing.ok) {
        return { canOpen: false, why: typing.reason }
      }
      const hostId = step.host ? matchBotItemStepHost(step.host, hosts, [thisComputer]) : null
      const place = step.host && hostId === null ? null : workspaceOn(hostId)
      if (!place) {
        return { canOpen: false, why: 'unknown-host' }
      }
      return {
        canOpen: true,
        open: () => {
          runQuickCommandInNewTab({
            command: {
              id: 'fork-bot-owner-step',
              label: step.title.slice(0, MAX_LABEL),
              action: 'terminal-command',
              command: typing.text,
              appendEnter: false
            },
            worktreeId: place.worktreeId,
            ...(place.hostId ? { executionHostId: place.hostId } : {}),
            typeOnly: true
          })
        }
      }
    },
    [enabled, hosts, thisComputer, workspaceOn]
  )
}
