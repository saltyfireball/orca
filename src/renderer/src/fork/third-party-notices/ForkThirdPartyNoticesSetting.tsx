// Third-party notices (BAD-897, FORK.md "Third-party notices"): opens the notices file the app
// bundle ships, in the system's text viewer.
import React, { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'

export function ForkThirdPartyNoticesSetting(): React.JSX.Element {
  const t = useTranslate()
  const [opening, setOpening] = useState(false)
  const failed = (detail?: string): void => {
    toast.error(t('fork.thirdPartyNotices.openFailed', 'Could not open the notices.'), {
      description: detail
    })
  }
  const open = async (): Promise<void> => {
    const api = window.api.forkThirdPartyNotices
    if (!api) {
      failed()
      return
    }
    setOpening(true)
    try {
      const result = await api.open()
      if (!result.ok) {
        failed(result.error)
      }
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error))
    } finally {
      setOpening(false)
    }
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.thirdPartyNotices.title', 'Third-party notices')}
        description={t(
          'fork.thirdPartyNotices.description',
          'The licenses of Orca, T3 Code and the open-source packages this app is built with.'
        )}
      />
      <SettingsRow
        label={t('fork.thirdPartyNotices.fileLabel', 'Notices file')}
        description={t(
          'fork.thirdPartyNotices.fileHelp',
          'Opens THIRD_PARTY_NOTICES.txt from the app bundle.'
        )}
        control={
          <Button size="sm" variant="outline" disabled={opening} onClick={() => void open()}>
            {t('fork.thirdPartyNotices.open', 'Open')}
          </Button>
        }
      />
    </section>
  )
}
