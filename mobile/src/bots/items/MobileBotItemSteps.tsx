// Fork BAD-747: the steps an agent asks the owner to do, on the phone: one numbered checklist with each
// step's title, host, command (wrapped, selectable, with Copy) and a Done check, and "Did not work" with
// the pasted error. No Open in terminal: a phone has none. The current step is open; others open on tap.
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Check, ChevronRight } from 'lucide-react-native'
import {
  botItemCurrentStepIndex,
  botItemStepsDoneCount,
  type BotItemStep,
  type BotItemStepState,
  type BotItemStepsView
} from '../../../../src/shared/bots/bot-item-steps'
import type { BotItem } from '../../../../src/shared/bots/bot-items'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { markBotItemStep } from './bot-item-operations'
import { MobileSourceCopyButton } from '../../components/code-presentation/MobileSourceCopyButton'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

export type MobileBotItemStepMark = (
  step: BotItemStep,
  state: BotItemStepState,
  error?: string
) => Promise<boolean>

function Step({
  step,
  current,
  online,
  onMark
}: {
  step: BotItemStep
  current: boolean
  online: boolean
  onMark: MobileBotItemStepMark
}): React.JSX.Element {
  const t = useMobileTranslation()
  const [opened, setOpened] = useState(false)
  const [failing, setFailing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const done = step.state === 'done'
  const expanded = (current || opened) && !done
  const mark = async (state: BotItemStepState, pasted?: string): Promise<void> => {
    setBusy(true)
    const ok = await onMark(step, state, pasted)
    setBusy(false)
    if (ok) {
      setFailing(false)
    }
  }
  const number = step.index + 1
  return (
    <View style={[styles.step, current && styles.stepCurrent, !current && !done && styles.dim]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: !online || busy }}
          accessibilityLabel={t('bots.items.steps.done', 'Done: step {{n}}', { n: number })}
          disabled={!online || busy}
          hitSlop={8}
          style={[styles.check, done && styles.checkOn]}
          onPress={() => void mark(done ? 'open' : 'done')}
        >
          {done ? <Check size={14} color={colors.bgBase} /> : null}
        </Pressable>
        <Pressable
          disabled={current || done}
          style={styles.titleBox}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setOpened(!opened)}
        >
          <Text style={[styles.title, done && styles.titleDone]}>
            <Text style={styles.number}>{number}. </Text>
            {step.title}
          </Text>
          <View style={styles.badges}>
            {step.host ? (
              <Text style={styles.badge}>
                {t('bots.items.steps.host', 'on {{host}}', { host: step.host })}
              </Text>
            ) : null}
            {!step.command ? (
              <Text style={styles.badgeMuted}>
                {t('bots.items.steps.manual', 'do this yourself')}
              </Text>
            ) : null}
            {step.state === 'failed' ? (
              <Text style={styles.badgeError}>{t('bots.items.steps.failed', 'Did not work')}</Text>
            ) : null}
          </View>
        </Pressable>
        {!current && !done ? <ChevronRight size={16} color={colors.textMuted} /> : null}
      </View>
      {expanded ? (
        <View style={styles.body}>
          {step.note ? <Text style={styles.note}>{step.note}</Text> : null}
          {step.command ? (
            <View style={styles.command}>
              <Text selectable style={styles.commandText}>
                {step.command}
              </Text>
              <View style={styles.copy}>
                <MobileSourceCopyButton
                  text={step.command}
                  accessibilityLabel={t('bots.items.steps.copy', 'Copy command')}
                />
              </View>
            </View>
          ) : null}
          {step.state === 'failed' && step.error ? (
            <Text selectable style={styles.errorText}>
              {step.error}
            </Text>
          ) : null}
          {failing ? (
            <View style={styles.failForm}>
              <TextInput
                multiline
                value={error}
                onChangeText={setError}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('bots.items.steps.errorPlaceholder', 'Paste the error you got')}
                placeholderTextColor={colors.textMuted}
                style={styles.errorInput}
              />
              <View style={styles.failActions}>
                <Pressable onPress={() => setFailing(false)} hitSlop={8}>
                  <Text style={styles.link}>{t('bots.items.steps.cancel', 'Cancel')}</Text>
                </Pressable>
                <Pressable
                  disabled={!error.trim() || !online || busy}
                  onPress={() => void mark('failed', error)}
                  hitSlop={8}
                >
                  <Text style={[styles.link, !error.trim() && styles.linkOff]}>
                    {t('bots.items.steps.sendError', 'Tell the bot')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              disabled={!online || busy}
              onPress={() => setFailing(true)}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.link}>{t('bots.items.steps.didNotWork', 'Did not work')}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  )
}

export function MobileBotItemSteps({
  view,
  online,
  onMark
}: {
  view: BotItemStepsView
  online: boolean
  onMark: MobileBotItemStepMark
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const current = botItemCurrentStepIndex(view)
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('bots.items.steps.title', 'Steps for you')}</Text>
        <Text style={styles.headerCount}>
          {t('bots.items.steps.progress', '{{done}} of {{total}} done', {
            done: botItemStepsDoneCount(view),
            total: view.steps.length
          })}
        </Text>
      </View>
      {view.steps.map((step) => (
        <Step
          key={`${view.eventId}:${step.index}`}
          step={step}
          current={step.index === current}
          online={online}
          onMark={onMark}
        />
      ))}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  wrap: { gap: spacing.xs },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  headerTitle: { fontSize: 13, color: colors.textMuted },
  headerCount: { fontSize: 13, color: colors.textMuted },
  step: {
    padding: spacing.sm,
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: spacing.xs
  },
  stepCurrent: { backgroundColor: colors.sheetGroup, borderColor: colors.borderSubtle },
  dim: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkOn: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  titleBox: { flex: 1, gap: 4 },
  title: { fontSize: 15, lineHeight: 20, color: colors.textPrimary },
  titleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  number: { color: colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    fontSize: 12,
    color: colors.textSecondary,
    backgroundColor: colors.bgRaised,
    borderRadius: 4,
    paddingHorizontal: 6
  },
  badgeMuted: { fontSize: 12, color: colors.textMuted },
  badgeError: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  body: { gap: spacing.sm, paddingLeft: 30 },
  note: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
  command: {
    borderRadius: radii.control,
    backgroundColor: colors.bgRaised,
    paddingLeft: spacing.sm,
    paddingVertical: spacing.sm,
    paddingRight: 40
  },
  commandText: { fontFamily: 'Menlo', fontSize: 12.5, lineHeight: 18, color: colors.textPrimary },
  copy: { position: 'absolute', top: 2, right: 2 },
  errorText: { fontFamily: 'Menlo', fontSize: 12, color: colors.textMuted },
  failForm: { gap: spacing.xs },
  errorInput: {
    minHeight: 72,
    borderRadius: radii.control,
    backgroundColor: colors.bgRaised,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontFamily: 'Menlo',
    fontSize: 12.5,
    textAlignVertical: 'top'
  },
  failActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  link: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  linkOff: { opacity: 0.4 }
}))

/** The page's steps: marks go to the host, and a refusal or a dropped connection shows as a toast. */
export function MobileBotItemStepsPanel({
  client,
  item,
  online,
  hostName,
  showToast
}: {
  client: RpcClient | null
  item: BotItem
  online: boolean
  hostName: string
  showToast: (message: string) => void
}): React.JSX.Element | null {
  const t = useMobileTranslation()
  if (!item.steps) {
    return null
  }
  return (
    <MobileBotItemSteps
      view={item.steps}
      online={online}
      onMark={async (step, state, error) => {
        const outcome = client
          ? await markBotItemStep(client, item, step.index, state, error)
          : ({ kind: 'not-sent' } as const)
        if (outcome.kind === 'done') {
          return true
        }
        showToast(
          outcome.kind === 'refused'
            ? outcome.message
            : outcome.kind === 'unknown'
              ? t('bots.items.steps.unknown', '{{host}} may not have taken that.', {
                  host: hostName
                })
              : t('bots.items.steps.notSent', 'Not sent. Check your connection.')
        )
        return false
      }}
    />
  )
}
