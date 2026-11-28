// Third-party notices (BAD-897, FORK.md "Third-party notices"): the About screen's row and the
// full-screen view of the notices file bundled with the iOS app.
import { useEffect, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { ScrollText, X } from 'lucide-react-native'
import { ListRow } from '../../list/ListGroup'
import { useWindowSafeAreaInsets } from '../../../layout/side-safe-area'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, pressedStyle, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { readThirdPartyNotices, thirdPartyNoticeBlocks } from './third-party-notices-file'

/** Render it only where thirdPartyNoticesShipped() is true. */
export function MobileThirdPartyNoticesRow(): React.JSX.Element {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const [open, setOpen] = useState(false)
  return (
    <>
      <ListRow
        title={t('fork.thirdPartyNotices.title', 'Third-party notices')}
        leading={<ScrollText size={18} color={colors.textSecondary} />}
        navigates
        onPress={() => setOpen(true)}
      />
      {open ? <NoticesScreen onClose={() => setOpen(false)} /> : null}
    </>
  )
}

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; blocks: string[] }

function NoticesScreen({ onClose }: { onClose: () => void }): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useWindowSafeAreaInsets()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  useEffect(() => {
    let live = true
    readThirdPartyNotices()
      .catch(() => null)
      .then((text) => {
        if (live) {
          setLoaded(
            text ? { state: 'ready', blocks: thirdPartyNoticeBlocks(text) } : { state: 'missing' }
          )
        }
      })
    return () => {
      live = false
    }
  }, [])
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top,
            paddingRight: insets.right,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left
          }
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            {t('fork.thirdPartyNotices.title', 'Third-party notices')}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel={t('fork.thirdPartyNotices.close', 'Close')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.close, pressed && pressedStyle]}
          >
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
        {loaded.state === 'ready' ? (
          <FlatList
            data={loaded.blocks}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={styles.body}
            renderItem={({ item }) => (
              <Text selectable style={styles.block}>
                {item}
              </Text>
            )}
          />
        ) : (
          <Text style={styles.note}>
            {loaded.state === 'loading'
              ? t('fork.thirdPartyNotices.loading', 'Loading...')
              : t('fork.thirdPartyNotices.missing', 'This build has no notices file.')}
          </Text>
        )}
      </View>
    </Modal>
  )
}

const styles = themedStyleSheet(() => ({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  title: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: '600' },
  close: { padding: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.md },
  block: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    lineHeight: 17
  },
  note: { padding: spacing.lg, color: colors.textMuted, fontSize: typography.bodySize }
}))
