// The fork Settings pane's own section links: one per section, kept in view while the pane
// scrolls, so every section is one click away from anywhere in it.
import { useRef } from 'react'
import { useSettingsContentScrollElement } from '@/components/settings/page/settings-content-scroll-element'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkSettingsSection } from './fork-settings-pane-catalog'

type Props = {
  sections: readonly Pick<ForkSettingsSection, 'id' | 'anchorId' | 'title'>[]
}

export function ForkSettingsSectionLinks({ sections }: Props): React.JSX.Element {
  const t = useTranslate()
  const scroller = useSettingsContentScrollElement()
  const navRef = useRef<HTMLElement>(null)
  const jump = (anchorId: string): void => {
    const target = document.getElementById(anchorId)
    if (!target) {
      return
    }
    if (!scroller) {
      target.scrollIntoView?.({ block: 'start' })
      return
    }
    // The links stay pinned over the top of the scroller, so land the section just below them.
    const top =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    const pinned = navRef.current?.offsetHeight ?? 0
    scroller.scrollTo({ top: Math.max(0, top - pinned - 8) })
  }
  return (
    <nav
      ref={navRef}
      aria-label={t('fork.settingsPane.sectionLinks', 'Sections')}
      data-fork-settings-section-links=""
      className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 bg-background px-1 py-2"
    >
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => jump(section.anchorId)}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {section.title}
        </button>
      ))}
    </nav>
  )
}
