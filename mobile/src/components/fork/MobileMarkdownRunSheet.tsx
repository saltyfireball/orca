import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  checkEditedRunCommand,
  type EditedRunCommandCheck
} from '../../../../src/shared/fork/shell-fence'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { TextField } from '../composer-input/TextField'

type Translate = ReturnType<typeof useMobileTranslation>

function refusalText(t: Translate, check: EditedRunCommandCheck): string | null {
  if (check.ok) {
    return null
  }
  switch (check.reason) {
    case 'empty':
      return t('components.markdownBlocks.runCode.refuseEmpty', 'Enter a command to run.')
    case 'multiline':
      return t('components.markdownBlocks.runCode.refuseMultiline', 'Keep the command on one line.')
    case 'unsafe':
      return t(
        'components.markdownBlocks.runCode.refuseUnsafe',
        'The command has a hidden or control character.'
      )
    case 'heredoc':
      return t('components.markdownBlocks.runCode.refuseHeredoc', 'Heredocs cannot run from here.')
    case 'continuation':
      return t(
        'components.markdownBlocks.runCode.refuseContinuation',
        'Remove the trailing backslash.'
      )
  }
}

/** The Run confirm body: the agent's command, editable; Run sends exactly the checked text. */
export function MobileMarkdownRunSheet({
  original,
  onRun,
  onCancel
}: {
  original: string
  onRun: (command: string) => void
  onCancel: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [text, setText] = useState(original)
  const check = checkEditedRunCommand(text)
  const refusal = refusalText(t, check)
  const submit = (): void => {
    if (check.ok) {
      onRun(check.command)
    }
  }
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('components.markdownBlocks.runCode.confirmTitle', 'Run in a new terminal?')}
        </Text>
        <Text style={styles.message}>
          {t('components.markdownBlocks.runCode.editHint', 'Edit the command if you need to.')}
        </Text>
      </View>
      <TextField
        value={text}
        onChangeText={setText}
        monospace
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
        onSubmitEditing={submit}
        accessibilityLabel={t('components.markdownBlocks.runCode.commandLabel', 'Command')}
        trailing={
          text !== original ? (
            <Pressable hitSlop={8} onPress={() => setText(original)} accessibilityRole="button">
              <Text style={styles.reset}>
                {t('components.markdownBlocks.runCode.reset', 'Reset')}
              </Text>
            </Pressable>
          ) : null
        }
      />
      {refusal ? <Text style={styles.error}>{refusal}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          onPress={onCancel}
        >
          <Text style={styles.cancelText}>
            {t('components.markdownBlocks.runCode.cancel', 'Cancel')}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.runButton,
            pressed && styles.pressed,
            !check.ok && styles.disabled
          ]}
          disabled={!check.ok}
          onPress={submit}
        >
          <Text style={styles.runText}>
            {t('components.markdownBlocks.runCode.confirm', 'Run')}
          </Text>
        </Pressable>
      </View>
    </>
  )
}

const styles = themedStyleSheet(() => ({
  header: { paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  title: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  message: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  reset: { fontSize: typography.metaSize, color: colors.textMuted, paddingHorizontal: spacing.xs },
  error: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md
  },
  cancelButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.control
  },
  runButton: {
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.control
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  cancelText: { color: colors.textSecondary, fontSize: typography.bodySize, fontWeight: '500' },
  runText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '600' }
}))
