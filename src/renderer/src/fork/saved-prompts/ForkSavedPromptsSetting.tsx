// Saved prompts (FORK.md, SLRM-2397) settings: the menu's switch (on) and the list itself, each
// prompt a label and its text. A change is saved when its field loses focus.
import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  MAX_SAVED_PROMPTS,
  MAX_SAVED_PROMPT_LABEL,
  MAX_SAVED_PROMPT_TEXT,
  normalizeSavedPrompt,
  readForkSavedPromptSettings,
  type ForkSavedPrompt
} from '../../../../shared/fork/saved-prompts'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function PromptRow({
  prompt,
  onSave,
  onRemove
}: {
  prompt: ForkSavedPrompt
  onSave: (next: ForkSavedPrompt) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [label, setLabel] = useState(prompt.label)
  const [text, setText] = useState(prompt.text)
  const commit = (): void => {
    const next = normalizeSavedPrompt({ label, text })
    if (next && (next.label !== prompt.label || next.text !== prompt.text)) {
      onSave(next)
    }
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2" data-fork-saved-prompt="">
      <div className="flex items-center gap-2">
        <Input
          value={label}
          maxLength={MAX_SAVED_PROMPT_LABEL}
          aria-label={t('fork.savedPrompts.labelField', 'Label')}
          className="h-8"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commit}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('fork.savedPrompts.remove', 'Remove this prompt')}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Textarea
        value={text}
        maxLength={MAX_SAVED_PROMPT_TEXT}
        rows={3}
        aria-label={t('fork.savedPrompts.textField', 'Prompt')}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

export function ForkSavedPromptsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkSavedPromptSettings(settings)
  const [adding, setAdding] = useState('')
  const save = (prompts: ForkSavedPrompt[]): void => updateSettings({ forkSavedPrompts: prompts })
  const add = (): void => {
    const next = normalizeSavedPrompt({ text: adding })
    if (next && current.prompts.length < MAX_SAVED_PROMPTS) {
      save([...current.prompts, next])
      setAdding('')
    }
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.savedPrompts.title', 'Saved prompts')}
        description={t(
          'fork.savedPrompts.description',
          'Prompts you reuse, in a menu beside Attach on the chat message box. Choosing one puts it in the box at the caret; nothing is sent until you send it.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.savedPrompts.enabledLabel', 'Saved prompts menu')}
        checked={current.enabled}
        onChange={() => updateSettings({ forkSavedPromptsEnabled: !current.enabled })}
      />
      <div className="space-y-2">
        {current.prompts.map((prompt, index) => (
          <PromptRow
            key={`${index}:${prompt.label}:${prompt.text.length}`}
            prompt={prompt}
            onSave={(next) => save(current.prompts.map((p, i) => (i === index ? next : p)))}
            onRemove={() => save(current.prompts.filter((_, i) => i !== index))}
          />
        ))}
        <div className="flex items-start gap-2">
          <Textarea
            value={adding}
            rows={2}
            maxLength={MAX_SAVED_PROMPT_TEXT}
            placeholder={t(
              'fork.savedPrompts.newPlaceholder',
              'A new prompt; its first line is its label'
            )}
            aria-label={t('fork.savedPrompts.newField', 'New prompt')}
            onChange={(event) => setAdding(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={adding.trim() === '' || current.prompts.length >= MAX_SAVED_PROMPTS}
            onClick={add}
          >
            <Plus className="size-4" />
            {t('fork.savedPrompts.add', 'Add')}
          </Button>
        </div>
      </div>
    </section>
  )
}
