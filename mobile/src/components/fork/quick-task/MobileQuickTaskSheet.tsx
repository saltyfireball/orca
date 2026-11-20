// Quick task (SLRM-2428, FORK.md): the sheet. One box for the task, the phone's own dictation in
// its action row, and Send. A refused send keeps the text and says why; a taken one says which bot
// has it, then the sheet closes by itself.
import { useCallback, useEffect, useState } from 'react'
import { AccessibilityInfo, Pressable, Text, View } from 'react-native'
import { CircleCheck } from 'lucide-react-native'
import { QUICK_TASK_TEXT_MAX } from '../../../../../src/shared/fork/quick-task-contract'
import type { QuickTaskSubmitResult } from '../../../../../src/shared/fork/quick-task-contract'
import { useMobileDictation } from '../../../hooks/use-mobile-dictation'
import { dictationFailureMessage } from '../../../dictation/mobile-dictation-setup'
import { useMobileDictationHaptics } from '../../../dictation/use-mobile-dictation-haptics'
import { dictationControlsCopy } from '../../../dictation/mobile-dictation-controls-copy'
import {
  MobileDictationCancelButton,
  MobileDictationFailureNote,
  MobileDictationMicIcon,
  MobileDictationRecordingMeter,
  MobileDictationRetryButton
} from '../../../dictation/MobileDictationLiveControls'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { triggerError, triggerSuccess } from '../../../platform/haptics/haptics'
import { colors, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { BottomDrawer } from '../../bottom-drawer/BottomDrawer'
import { MessageBox } from '../../composer-input/MessageBox'
import {
  COMPOSER_CONTROL_HIT_SLOP,
  composerInputStyles
} from '../../composer-input/composer-input-styles'
import {
  appendQuickTaskDictation,
  checkQuickTaskText,
  quickTaskSentMessage,
  submitQuickTask
} from './quick-task-submit'

// Long enough to read the bot's name and its note.
const SENT_CLOSE_MS = 2500

type SheetProps = {
  visible: boolean
  hostName: string | null
  client: RpcClient | null
  onClose: () => void
}

export function MobileQuickTaskSheet(props: SheetProps): React.JSX.Element {
  return (
    <BottomDrawer visible={props.visible} onClose={props.onClose}>
      {props.visible ? <QuickTaskBody {...props} /> : null}
    </BottomDrawer>
  )
}

function QuickTaskBody({ hostName, client, onClose }: SheetProps): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<QuickTaskSubmitResult | null>(null)

  const dictation = useMobileDictation({
    client,
    enabled: !sending && sent === null,
    onTranscript: (words) => setText((current) => appendQuickTaskDictation(current, words)),
    onError: (err, { kept }) => {
      if (!kept) {
        setError(dictationFailureMessage(err.message))
      }
    }
  })
  const stopDictation = useMobileDictationHaptics(dictation)

  useEffect(() => {
    if (!sent) {
      return
    }
    const timer = setTimeout(onClose, SENT_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [onClose, sent])

  const send = useCallback(() => {
    const checked = checkQuickTaskText(text)
    if (!checked.ok) {
      setError(checked.reason)
      return
    }
    if (!client) {
      setError(t('fork.quickTask.offline', 'This computer is not connected. Try again.'))
      return
    }
    setError(null)
    setSending(true)
    void submitQuickTask(client, checked.text).then(
      (result) => {
        setSending(false)
        setSent(result)
        triggerSuccess()
        AccessibilityInfo.announceForAccessibility(
          [quickTaskSentMessage(result), result.note].filter(Boolean).join('. ')
        )
      },
      (err: unknown) => {
        setSending(false)
        triggerError()
        setError(err instanceof Error ? err.message : String(err))
      }
    )
  }, [client, t, text])

  if (sent) {
    return (
      <View style={styles.sent} accessibilityLiveRegion="polite">
        <CircleCheck size={28} color={colors.statusGreen} strokeWidth={2} />
        <Text style={styles.title}>{quickTaskSentMessage(sent)}</Text>
        {sent.note ? <Text style={styles.message}>{sent.note}</Text> : null}
      </View>
    )
  }

  const live = dictation.isStarting || dictation.isRecording || dictation.isProcessing
  const leading = dictation.failure ? (
    <View style={styles.leading}>
      <MobileDictationCancelButton discards onCancel={() => void dictation.cancel()} />
      <MobileDictationFailureNote compact reason={dictation.failure.message} />
      <MobileDictationRetryButton labelled={false} onRetry={() => void dictation.retry()} />
    </View>
  ) : live ? (
    <View style={styles.leading}>
      <MobileDictationCancelButton onCancel={() => void dictation.cancel()} />
      {dictation.isRecording ? (
        <MobileDictationRecordingMeter
          meter={dictation.meter}
          engine={dictation.engine}
          computerName={hostName}
          dotSize={5}
        />
      ) : null}
      <MicButton
        active={dictation.isRecording}
        processing={dictation.isProcessing || dictation.isStarting}
        onPress={stopDictation}
      />
    </View>
  ) : (
    <MicButton
      active={false}
      processing={false}
      disabled={sending}
      onPress={() => void dictation.start(client)}
    />
  )

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{t('fork.quickTask.title', 'Quick task')}</Text>
        <Text style={styles.message}>
          {hostName
            ? t('fork.quickTask.messageOn', '{{host}} hands it to the bot that owns the project.', {
                host: hostName
              })
            : t(
                'fork.quickTask.message',
                'Your computer hands it to the bot that owns the project.'
              )}
        </Text>
      </View>
      <MessageBox
        value={text}
        onChangeText={(next) => {
          setText(next)
          setError(null)
        }}
        autoFocus
        editable={!sending}
        maxLength={QUICK_TASK_TEXT_MAX}
        placeholder={t('fork.quickTask.placeholder', 'What needs doing, and for which project?')}
        leading={leading}
        onSend={send}
        canSend={text.trim().length > 0 && !live}
        sending={sending}
        sendAccessibilityLabel={t('fork.quickTask.send', 'Send task')}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  )
}

function MicButton(props: {
  active: boolean
  processing: boolean
  disabled?: boolean
  onPress: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.active ? dictationControlsCopy.stop() : dictationControlsCopy.start()
      }
      accessibilityState={{ disabled: Boolean(props.disabled), busy: props.processing }}
      disabled={props.disabled || props.processing}
      hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      style={({ pressed }) => [
        composerInputStyles.controlButton,
        pressed && composerInputStyles.pressed
      ]}
      onPress={props.onPress}
    >
      <MobileDictationMicIcon
        active={props.active}
        processing={props.processing}
        micSize={19}
        micStroke={2}
      />
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary
  },
  message: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2
  },
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    minWidth: 0
  },
  error: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  sent: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md
  }
}))
