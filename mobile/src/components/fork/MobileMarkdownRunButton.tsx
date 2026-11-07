import { useContext, useState } from 'react'
import { Pressable } from 'react-native'
import { Play } from 'lucide-react-native'
import { commandFromShellFence } from '../../../../src/shared/fork/shell-fence'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { MobileNativeChatDisclosureContext } from '../../session/native-chat/transcript/mobile-native-chat-disclosure-store'
import { colors, radii } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { ConfirmModal } from '../ConfirmModal'
import { MobileMarkdownRunContext } from './mobile-markdown-run-context'

const LABEL_PREVIEW_LENGTH = 40

/** Runs a chat shell fence in a new terminal of the session, only after the user confirms. */
export function MobileMarkdownRunButton({
  code,
  language
}: {
  code: string
  language: string | undefined
}): React.JSX.Element | null {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const launch = useContext(MobileMarkdownRunContext)
  const chat = useContext(MobileNativeChatDisclosureContext) !== null
  const [confirming, setConfirming] = useState(false)
  const command = commandFromShellFence(code, language)
  if (!launch || !chat || !command) {
    return null
  }
  const label = t('components.markdownBlocks.runCode.action', 'Run in terminal')
  const run = () => {
    const preview = command.replace(/\s+/g, ' ').trim().slice(0, LABEL_PREVIEW_LENGTH)
    launch({
      id: 'fork-chat-run',
      label: t('components.markdownBlocks.runCode.tabLabel', 'Chat: {{command}}', {
        command: preview
      }),
      action: 'terminal-command',
      command,
      appendEnter: true
    })
  }
  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setConfirming(true)}
      >
        <Play size={14} color={colors.textMuted} />
      </Pressable>
      {/* In-page confirm: Alert.alert is a no-op on web, and the iOS session is the web page. */}
      {confirming ? (
        <ConfirmModal
          visible
          title={t('components.markdownBlocks.runCode.confirmTitle', 'Run in a new terminal?')}
          message={command}
          confirmLabel={t('components.markdownBlocks.runCode.confirm', 'Run')}
          cancelLabel={t('components.markdownBlocks.runCode.cancel', 'Cancel')}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
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
