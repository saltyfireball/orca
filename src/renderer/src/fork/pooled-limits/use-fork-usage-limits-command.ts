// Pooled limits (FORK.md, SLRM-2392): `/usage-limits` in a structured chat opens the pooled limits
// dialog and never reaches the agent. Two hooks in upstream's composer: the catalog adds the row,
// and the command picker wraps its Orca commands with this one.
import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { translate } from '@/i18n/i18n'
import type { SlashCommandSuggestion } from '../../../../shared/native-chat/input/commands/native-chat-slash-commands'
import type { NativeChatPickerItem } from '../../../../shared/native-chat/input/composer/native-chat-picker-items'
import type { NativeChatPickerState } from '@/components/native-chat/composer/pickers/use-native-chat-picker-state'
import type { NativeChatResumeCommand } from '@/components/native-chat/composer/pickers/use-native-chat-resume-command'
import {
  writeNativeChatComposerText,
  type NativeChatComposerInput
} from '@/components/native-chat/composer/editor/native-chat-composer-input'
import { useForkPooledLimitsEnabled } from './ForkPooledLimitsRoster'
import { openForkPooledLimitsDialog } from './ForkPooledLimitsDialog'

export const FORK_USAGE_LIMITS_COMMAND = 'usage-limits'
const DRAFT = /^\/usage-limits\s*$/i

export function isForkUsageLimitsDraft(draft: string): boolean {
  return DRAFT.test(draft.trim())
}

/** The picker row, after the agent's own commands; an agent command of the same name gives way. */
export function withForkUsageLimitsCommand(
  commands: readonly SlashCommandSuggestion[],
  enabled: boolean
): readonly SlashCommandSuggestion[] {
  if (!enabled) {
    return commands
  }
  return [
    ...commands.filter((command) => command.name !== FORK_USAGE_LIMITS_COMMAND),
    {
      name: FORK_USAGE_LIMITS_COMMAND,
      description: translate(
        'fork.pooledLimits.commandDescription',
        'Usage limits pooled across every account and machine'
      ),
      orcaOwned: true
    }
  ]
}

/** Catalog hook: structured chats only. */
export function useForkUsageLimitsCatalog(
  commands: readonly SlashCommandSuggestion[],
  structured: boolean
): readonly SlashCommandSuggestion[] {
  const enabled = useForkPooledLimitsEnabled() && structured
  return useMemo(() => withForkUsageLimitsCommand(commands, enabled), [commands, enabled])
}

/** Command picker hook: runs `/usage-limits` itself, and hands every other draft to `inner`. */
export function useForkUsageLimitsCommand(
  inner: NativeChatResumeCommand,
  args: {
    active: boolean
    picker: Pick<NativeChatPickerState, 'autocomplete' | 'isPickedSkill'>
    editor: {
      textareaRef: RefObject<NativeChatComposerInput | null>
      setDraft: (value: string) => void
      setCaret: Dispatch<SetStateAction<number>>
      setActiveSuggestion: Dispatch<SetStateAction<number>>
    }
  }
): NativeChatResumeCommand {
  const enabled = useForkPooledLimitsEnabled() && args.active
  const { autocomplete, isPickedSkill } = args.picker
  const { textareaRef, setDraft, setCaret, setActiveSuggestion } = args.editor
  const run = useCallback((): void => {
    openForkPooledLimitsDialog()
    setDraft('')
    setCaret(0)
    setActiveSuggestion(0)
    const input = textareaRef.current
    if (input) {
      writeNativeChatComposerText(input, '', 0)
    }
  }, [setActiveSuggestion, setCaret, setDraft, textareaRef])
  const mine = useCallback(
    (draft: string) => enabled && !isPickedSkill(draft) && isForkUsageLimitsDraft(draft),
    [enabled, isPickedSkill]
  )
  return useMemo(
    (): NativeChatResumeCommand => ({
      matchesDraft: (draft) => mine(draft) || inner.matchesDraft(draft),
      consume: (draft) => {
        if (!mine(draft)) {
          return inner.consume(draft)
        }
        run()
        return true
      },
      interceptPick:
        <TItem extends NativeChatPickerItem>(pick: (item: TItem) => void) =>
        (item: TItem) => {
          const leading = autocomplete.mode === 'slash' && autocomplete.dispatchable
          if (
            enabled &&
            leading &&
            item.kind === 'command' &&
            item.orcaOwned &&
            item.name === FORK_USAGE_LIMITS_COMMAND
          ) {
            run()
            return
          }
          inner.interceptPick(pick)(item)
        }
    }),
    [autocomplete, enabled, inner, mine, run]
  )
}
