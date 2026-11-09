import { useCallback, useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { commandFromShellFence } from '../../../../../shared/fork/shell-fence'
import {
  useNativeChatVisualOwner,
  type NativeChatVisualOwner
} from '../media/visuals/native-chat-visual-owner'
import {
  isNativeChatRunTargetCurrent,
  nativeChatRunLaunchHostId,
  type NativeChatRunTarget
} from './native-chat-run-target'
import { NativeChatRunDialog } from './NativeChatRunDialog'
import { findNativeChatRunWorkspace, readNativeChatRunPlace } from './native-chat-run-workspace'

const LABEL_PREVIEW_LENGTH = 40

/** Runs a shell fence in a new terminal tab of the chat's workspace, only after the user confirms. */
export function NativeChatRunButton({
  code,
  language
}: {
  code: string
  language?: string
}): React.JSX.Element | null {
  const owner = useNativeChatVisualOwner()
  const command = commandFromShellFence(code, language)
  if (!owner || !command) {
    return null
  }
  return <RunButton command={command} owner={owner} />
}

function isRunTargetCurrent(
  captured: NativeChatRunTarget,
  liveOwner: NativeChatVisualOwner | null
): boolean {
  const state = useAppStore.getState()
  return isNativeChatRunTargetCurrent({
    captured,
    liveOwner,
    onHost: readNativeChatRunPlace(state, captured.worktreeId, captured.hostId),
    selected: readNativeChatRunPlace(state, captured.worktreeId)
  })
}

function refuseStaleRun(): void {
  toast.error(
    translate(
      'components.native-chat.runCode.staleTarget',
      'Not run: this chat no longer points at the same workspace and host.'
    )
  )
}

type CapturedRun = Readonly<NativeChatRunTarget & { command: string; title: string }>

function RunButton({
  command,
  owner
}: {
  command: string
  owner: NativeChatVisualOwner
}): React.JSX.Element {
  const { worktreeId, tabId } = owner
  // The confirm compares against the chat's owner at answer time, not at dialog open.
  const liveOwnerRef = useRef<NativeChatVisualOwner | null>(owner)
  useEffect(() => {
    liveOwnerRef.current = owner
    return () => {
      liveOwnerRef.current = null
    }
  }, [owner])
  const workspaceName = useAppStore(
    (s) => findNativeChatRunWorkspace(s, worktreeId)?.displayName ?? null
  )
  // A chat in a terminal pane is keyed by its terminal tab; a chat tab by its own id.
  const groupId = useAppStore((s) =>
    tabId
      ? (s.unifiedTabsByWorktree[worktreeId]?.find(
          (tab) => tab.id === tabId || tab.entityId === tabId
        )?.groupId ?? null)
      : null
  )

  const [pending, setPending] = useState<CapturedRun | null>(null)

  const handleRun = useCallback(() => {
    // Frozen here so the dialog opens on, and the tab runs on, exactly this workspace and host.
    const place = readNativeChatRunPlace(useAppStore.getState(), worktreeId)
    if (!place?.route) {
      refuseStaleRun()
      return
    }
    const captured: CapturedRun = Object.freeze({
      command,
      title: translate('components.native-chat.runCode.confirmTitle', 'Run in {{name}}?', {
        name: workspaceName ?? worktreeId
      }),
      target: owner.target,
      worktreeId,
      hostId: place.hostId,
      route: place.route,
      groupId
    })
    if (!isRunTargetCurrent(captured, liveOwnerRef.current)) {
      refuseStaleRun()
      return
    }
    setPending(captured)
  }, [command, groupId, owner.target, workspaceName, worktreeId])

  // Runs the text the user confirmed, already checked by the dialog, on the captured target.
  const runConfirmed = useCallback((captured: CapturedRun, confirmedCommand: string) => {
    setPending(null)
    if (!isRunTargetCurrent(captured, liveOwnerRef.current)) {
      refuseStaleRun()
      return
    }
    runQuickCommandInNewTab({
      command: {
        id: 'fork-chat-run',
        label: translate('components.native-chat.runCode.tabLabel', 'Chat: {{command}}', {
          command: confirmedCommand.slice(0, LABEL_PREVIEW_LENGTH)
        }),
        action: 'terminal-command',
        command: confirmedCommand,
        appendEnter: true
      },
      worktreeId: captured.worktreeId,
      executionHostId: nativeChatRunLaunchHostId(captured),
      groupId: captured.groupId
    })
  }, [])

  const label = translate('components.native-chat.runCode.action', 'Run in terminal')
  return (
    <>
      <button
        type="button"
        onClick={handleRun}
        aria-label={label}
        title={label}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Play className="size-3.5" />
      </button>
      {pending ? (
        <NativeChatRunDialog
          title={pending.title}
          original={pending.command}
          onRun={(confirmedCommand) => runConfirmed(pending, confirmedCommand)}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  )
}
