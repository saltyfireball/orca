// Fork BAD-762: the slim "Steps 1 of 3" line pinned above the item's scroll while its steps sit in the
// ask's card: a tap scrolls to the first step not done.
import { Pressable, Text } from 'react-native'
import {
  botItemCurrentStepIndex,
  type BotItemStepsView
} from '../../../../src/shared/bots/bot-item-steps'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

export function MobileBotItemStepsLine({
  view,
  onPress
}: {
  view: BotItemStepsView
  onPress: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const total = view.steps.length
  const at = Math.min(botItemCurrentStepIndex(view) + 1, total)
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={styles.line}>
      <Text style={styles.text}>
        {t('bots.items.steps.line', 'Steps {{at}} of {{total}}', { at, total })}
      </Text>
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  line: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  text: { fontSize: 13, color: colors.textMuted }
}))
