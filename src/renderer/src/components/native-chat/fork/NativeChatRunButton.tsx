import { useCallback, useContext, useEffect, useRef } from 'react'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { commandFromShellFence } from '../../../../../shared/fork/shell-fence'
import { useNativeChatVisualOwner, type NativeChatVisualOwner } from '../native-chat-visual-owner'
import {
  isNativeChatRunTargetCurrent,
  nativeChatRunLaunchHostId,
  type NativeChatRunTarget
} from './native-chat-run-target'
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
  // Without a confirm prompt there is no safe way to run, so hide rather than run unasked.
  const confirm = useContext(ConfirmationDialogContext)
  const command = commandFromShellFence(code, language)
  if (!owner || !confirm || !command) {
    return null
  }
  return <RunButton command={command} owner={owner} confirm={confirm} />
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

function RunButton({
  command,
  owner,
  confirm
}: {
  command: string
  owner: NativeChatVisualOwner
  confirm: ConfirmationDialogContextValue
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

  const handleRun = useCallback(async () => {
    // Frozen here so the dialog shows, and the tab runs, exactly this string on exactly this host.
    const place = readNativeChatRunPlace(useAppStore.getState(), worktreeId)
    if (!place?.route) {
      refuseStaleRun()
      return
    }
    const captured: Readonly<NativeChatRunTarget & { command: string }> = Object.freeze({
      command,
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
    const confirmed = await confirm({
      title: translate('components.native-chat.runCode.confirmTitle', 'Run in {{name}}?', {
        name: workspaceName ?? worktreeId
      }),
      description: captured.command,
      descriptionClassName:
        'max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground',
      confirmLabel: translate('components.native-chat.runCode.confirm', 'Run'),
      cancelLabel: translate('components.native-chat.runCode.cancel', 'Cancel')
    })
    if (!confirmed) {
      return
    }
    if (!isRunTargetCurrent(captured, liveOwnerRef.current)) {
      refuseStaleRun()
      return
    }
    runQuickCommandInNewTab({
      command: {
        id: 'fork-chat-run',
        label: translate('components.native-chat.runCode.tabLabel', 'Chat: {{command}}', {
          command: captured.command.slice(0, LABEL_PREVIEW_LENGTH)
        }),
        action: 'terminal-command',
        command: captured.command,
        appendEnter: true
      },
      worktreeId: captured.worktreeId,
      executionHostId: nativeChatRunLaunchHostId(captured),
      groupId: captured.groupId
    })
  }, [command, confirm, groupId, owner.target, workspaceName, worktreeId])

  const label = translate('components.native-chat.runCode.action', 'Run in terminal')
  return (
    <button
      type="button"
      onClick={() => void handleRun()}
      aria-label={label}
      title={label}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Play className="size-3.5" />
    </button>
  )
}
