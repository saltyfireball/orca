// FORK.md "Custom ACP agents" (BAD-873): the + menu's custom agents, after the agents. Picking one
// opens a chat on it in this workspace. Nothing shows until the workspace's host has one saved.
import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import {
  runtimeTargetEnvironmentId,
  runtimeTargetForOwnerEnvironment
} from '@/runtime/rpc/targets/runtime-client-target'
import { forkClaudeWorktreeTarget } from '@/fork/claude-account-move/fork-claude-move-actions'
import type {
  ForkCustomAcpAgentRow,
  ForkCustomAcpAgentsListResult
} from '../../../../shared/fork/custom-acp-agents/custom-acp-agents-wire'

export function ForkCustomAcpAgentMenuItems({
  worktreeId
}: {
  worktreeId: string | null | undefined
}): React.JSX.Element | null {
  const t = useTranslate()
  // A string, so a store write that leaves the host alone does not list again.
  const hostKey = useAppStore((state) => {
    const target = worktreeId ? forkClaudeWorktreeTarget(state, worktreeId) : null
    return target ? (runtimeTargetEnvironmentId(target) ?? '') : null
  })
  const target = useMemo(
    () => (hostKey === null ? null : runtimeTargetForOwnerEnvironment(hostKey || null)),
    [hostKey]
  )
  const [agents, setAgents] = useState<ForkCustomAcpAgentRow[]>([])
  useEffect(() => {
    if (!target) {
      setAgents([])
      return
    }
    let live = true
    callRuntimeRpc<ForkCustomAcpAgentsListResult>(
      target,
      'fork.customAcpAgents.list',
      {},
      { background: true }
    )
      .then((listed) => live && setAgents(Array.isArray(listed.agents) ? listed.agents : []))
      // An older host has no custom agents.
      .catch(() => live && setAgents([]))
    return () => {
      live = false
    }
  }, [target])
  if (!target || !worktreeId || agents.length === 0) {
    return null
  }
  const start = (name: string): void => {
    void callRuntimeRpc(target, 'fork.customAcpAgents.startChat', {
      name,
      worktree: `id:${worktreeId}`,
      focus: true
    }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error))
    )
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t('fork.customAcpAgents.menuLabel', 'Custom agents')}</DropdownMenuLabel>
      {agents.map((agent) => (
        <DropdownMenuItem key={agent.name} variant="create" onSelect={() => start(agent.name)}>
          {agent.name}
        </DropdownMenuItem>
      ))}
    </>
  )
}
