import { useCallback, useContext } from 'react'
import { Play } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { commandFromShellFence } from '../../../../../shared/fork/shell-fence'
import { useNativeChatVisualOwner } from '../media/visuals/native-chat-visual-owner'

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
  return (
    <RunButton
      command={command}
      worktreeId={owner.worktreeId}
      tabId={owner.tabId}
      confirm={confirm}
    />
  )
}

function RunButton({
  command,
  worktreeId,
  tabId,
  confirm
}: {
  command: string
  worktreeId: string
  tabId?: string
  confirm: ConfirmationDialogContextValue
}): React.JSX.Element {
  const workspaceName = useAppStore(
    (s) => findWorktreeById(selectWorktreesByRepo(s), worktreeId)?.displayName ?? null
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
    const confirmed = await confirm({
      title: translate('components.native-chat.runCode.confirmTitle', 'Run in {{name}}?', {
        name: workspaceName ?? worktreeId
      }),
      description: command,
      descriptionClassName:
        'max-h-48 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground',
      confirmLabel: translate('components.native-chat.runCode.confirm', 'Run'),
      cancelLabel: translate('components.native-chat.runCode.cancel', 'Cancel')
    })
    if (!confirmed) {
      return
    }
    const preview = command.replace(/\s+/g, ' ').trim().slice(0, LABEL_PREVIEW_LENGTH)
    runQuickCommandInNewTab({
      command: {
        id: 'fork-chat-run',
        label: translate('components.native-chat.runCode.tabLabel', 'Chat: {{command}}', {
          command: preview
        }),
        action: 'terminal-command',
        command,
        appendEnter: true
      },
      worktreeId,
      groupId
    })
  }, [command, confirm, groupId, workspaceName, worktreeId])

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
