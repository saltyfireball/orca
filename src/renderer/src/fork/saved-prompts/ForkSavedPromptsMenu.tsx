// Saved prompts (FORK.md, SLRM-2397): a menu beside Attach on a chat's message box. A saved
// prompt goes into the box at the caret (nothing is sent); a stashed draft (Prompt stash) comes
// back into an empty box. "Edit saved prompts..." opens their card in Settings > Blackfish.
// The message box is found from the button itself, through the composer's scope attribute.
import React, { useRef, useSyncExternalStore } from 'react'
import { BookMarked, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { insertNativeChatComposerDraftText } from '@/components/native-chat/drafts/native-chat-composer-draft-insertion'
import { readForkSavedPromptSettings } from '../../../../shared/fork/saved-prompts'
import { stashLabel } from '../../../../shared/fork/prompt-stash'
import {
  dropForkStashedDraft,
  readForkPromptStash,
  restoreForkDraft,
  subscribeForkPromptStash
} from '../prompt-stash/fork-prompt-stash'

function composerScope(element: HTMLElement | null): string | null {
  return (
    element?.closest<HTMLElement>('[data-native-chat-composer-scope]')?.dataset
      .nativeChatComposerScope ?? null
  )
}

function openSavedPromptSettings(): void {
  const { openSettingsPage, openSettingsTarget } = useAppStore.getState()
  openSettingsPage()
  openSettingsTarget({ pane: 'fork', repoId: null, sectionId: 'fork-settings-chats' })
}

export function ForkSavedPromptsMenu(): React.JSX.Element | null {
  const t = useTranslate()
  const trigger = useRef<HTMLButtonElement>(null)
  const savedEnabled = useAppStore((s) => s.settings?.forkSavedPromptsEnabled !== false)
  const raw = useAppStore((s) => s.settings?.forkSavedPrompts)
  const stashOn = useAppStore((s) => s.settings?.forkPromptStash !== false)
  const stash = useSyncExternalStore(subscribeForkPromptStash, readForkPromptStash)
  const prompts = readForkSavedPromptSettings({ forkSavedPrompts: raw }).prompts
  const stashed = stashOn ? stash : []
  if (!savedEnabled && stashed.length === 0) {
    return null
  }
  const label = t('fork.savedPrompts.button', 'Saved prompts')
  const withScope = (run: (scope: string) => void) => () => {
    const scope = composerScope(trigger.current)
    if (scope) {
      run(scope)
    }
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="pointer-coarse:size-11"
            >
              <BookMarked className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-96 w-72 overflow-y-auto scrollbar-sleek"
      >
        {savedEnabled ? (
          <>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {prompts.length === 0 ? (
              <DropdownMenuItem disabled>
                {t('fork.savedPrompts.none', 'No saved prompts yet')}
              </DropdownMenuItem>
            ) : (
              prompts.map((prompt, index) => (
                <DropdownMenuItem
                  key={`${index}:${prompt.label}`}
                  title={prompt.text.slice(0, 400)}
                  onSelect={withScope((scope) =>
                    insertNativeChatComposerDraftText(scope, prompt.text)
                  )}
                >
                  <span className="truncate">{prompt.label}</span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuItem onSelect={openSavedPromptSettings}>
              {t('fork.savedPrompts.edit', 'Edit saved prompts...')}
            </DropdownMenuItem>
          </>
        ) : null}
        {stashed.length > 0 ? (
          <>
            {savedEnabled ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>
              {t('fork.promptStash.menuTitle', 'Stashed drafts')}
            </DropdownMenuLabel>
            {stashed.map((draft, index) => (
              <DropdownMenuItem
                key={`${draft.at}:${index}`}
                onSelect={withScope((scope) => void restoreForkDraft(scope, index))}
              >
                <span className="min-w-0 flex-1 truncate">{stashLabel(draft) || '...'}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={t('fork.promptStash.drop', 'Drop this stashed draft')}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    dropForkStashedDraft(index)
                  }}
                >
                  <X className="size-3" />
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
