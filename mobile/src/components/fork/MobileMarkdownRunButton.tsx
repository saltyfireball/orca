import { useContext } from 'react'
import { Pressable } from 'react-native'
import { Play } from 'lucide-react-native'
import { commandFromShellFence } from '../../../../src/shared/fork/shell-fence'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { MobileNativeChatDisclosureContext } from '../../session/native-chat/transcript/mobile-native-chat-disclosure-store'
import { colors, radii } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { MobileMarkdownRunContext } from './mobile-markdown-run-context'

/** Offers to run a chat shell fence in a new terminal of the session; the provider confirms first. */
export function MobileMarkdownRunButton({
  code,
  language
}: {
  code: string
  language: string | undefined
}): React.JSX.Element | null {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const requestRun = useContext(MobileMarkdownRunContext)
  const chat = useContext(MobileNativeChatDisclosureContext) !== null
  const command = commandFromShellFence(code, language)
  if (!requestRun || !chat || !command) {
    return null
  }
  const label = t('components.markdownBlocks.runCode.action', 'Run in terminal')
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => requestRun(command)}
    >
      <Play size={14} color={colors.textMuted} />
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  button: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control
  },
  pressed: { backgroundColor: colors.bgRaised }
}))
