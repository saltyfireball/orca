import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  checkEditedRunCommand,
  type EditedRunCommandCheck
} from '../../../../../shared/fork/shell-fence'

export function editedRunRefusal(check: EditedRunCommandCheck): string | null {
  if (check.ok) {
    return null
  }
  switch (check.reason) {
    case 'empty':
      return translate('components.native-chat.runCode.refuseEmpty', 'Enter a command to run.')
    case 'multiline':
      return translate(
        'components.native-chat.runCode.refuseMultiline',
        'Keep the command on one line.'
      )
    case 'unsafe':
      return translate(
        'components.native-chat.runCode.refuseUnsafe',
        'The command has a hidden or control character.'
      )
    case 'heredoc':
      return translate(
        'components.native-chat.runCode.refuseHeredoc',
        'Heredocs cannot run from here.'
      )
    case 'continuation':
      return translate(
        'components.native-chat.runCode.refuseContinuation',
        'Remove the trailing backslash.'
      )
  }
}

/**
 * The Run confirm: the agent's command, editable. Run sends exactly the checked field text;
 * Enter runs, Escape or Cancel closes without running.
 */
export function NativeChatRunDialog({
  title,
  original,
  onRun,
  onClose
}: {
  title: string
  original: string
  onRun: (command: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState(original)
  const check = checkEditedRunCommand(text)
  const refusal = editedRunRefusal(check)
  const submit = (): void => {
    if (check.ok) {
      onRun(check.command)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Portaled, but React still bubbles its events through the chat transcript; keep them here. */}
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {translate(
              'components.native-chat.runCode.editHint',
              'Edit the command if you need to. Enter runs it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          variant="code"
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={3}
          value={text}
          aria-invalid={refusal !== null}
          aria-label={translate('components.native-chat.runCode.commandLabel', 'Command')}
          className="max-h-48 resize-none [overflow-wrap:anywhere]"
          onFocus={(event) => {
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!event.repeat) {
                submit()
              }
            }
          }}
        />
        <div className="flex min-h-5 items-center justify-between gap-3 text-xs">
          <span className="text-destructive">{refusal}</span>
          {text !== original ? (
            <button
              type="button"
              className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setText(original)}
            >
              {translate('components.native-chat.runCode.reset', 'Reset')}
            </button>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {translate('components.native-chat.runCode.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={!check.ok} onClick={submit}>
            {translate('components.native-chat.runCode.confirm', 'Run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
