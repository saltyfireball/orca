// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { isSettingsNavigationTarget } from '@/components/settings/navigation/settings-navigation-types'
import {
  buildForkSettingsNavSections,
  FORK_SETTINGS_PANE_ID,
  getForkSettingsSections
} from './fork-settings-pane-catalog'

const repos = [
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `repo-${index + 1}`,
    path: `/home/test/code/project-${index + 1}`,
    displayName: `project-${index + 1}`
  })),
  { id: 'folder-1', path: '/home/test/notes', displayName: 'notes-folder', kind: 'folder' }
]

vi.mock('../../store/index', () => ({
  useAppStore: <T,>(select: (state: { repos: typeof repos }) => T): T => select({ repos })
}))

const { ForkSettingsPane } = await import('./ForkSettingsPane')

beforeEach(() => {
  // The cards read the preload API. None of what they fetch matters to the layout.
  vi.stubGlobal('api', {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPane(overrides: Partial<GlobalSettings> = {}) {
  const updateSettings = vi.fn()
  const settings = { ...getDefaultSettings('/home/test'), ...overrides }
  const view = render(<ForkSettingsPane settings={settings} updateSettings={updateSettings} />)
  return { updateSettings, view }
}

function projectRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-fork-project-settings]')]
}

describe('ForkSettingsPane', () => {
  it('renders every section with a link to it', () => {
    const { view } = renderPane()
    const links = within(screen.getByRole('navigation', { name: 'Sections' }))
    for (const section of getForkSettingsSections()) {
      expect(links.getByRole('button', { name: section.title })).toBeTruthy()
      expect(view.container.querySelector(`#${section.anchorId}`)).not.toBeNull()
    }
  })

  it('renders the heading every search entry jumps to, inside a card', () => {
    const { view } = renderPane()
    const headings = [...view.container.querySelectorAll('h1,h2,h3,h4,h5,label,legend')]
    for (const section of getForkSettingsSections()) {
      for (const entry of section.entries) {
        const heading = headings.find((node) => node.textContent?.trim() === entry.title)
        expect(heading, entry.title).toBeTruthy()
        expect(heading?.closest('[data-settings-group-card]'), entry.title).not.toBeNull()
        expect(heading?.closest(`#${section.anchorId}`), entry.title).not.toBeNull()
      }
    }
  })

  it('lists each project once, closed, and leaves folders out', () => {
    const { view } = renderPane()
    const rows = projectRows(view.container)
    expect(rows).toHaveLength(30)
    expect(view.container.querySelectorAll('[data-fork-project-settings-list]')).toHaveLength(1)
    for (const row of rows) {
      expect(row.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    }
    const text = view.container.textContent ?? ''
    expect(text.split('project-17').length - 1).toBe(1)
    expect(text).not.toContain('notes-folder')
    const list = view.container.querySelector('[data-fork-project-settings-list]')
    expect(list?.querySelectorAll('input,select,[role="combobox"]')).toHaveLength(0)
  })

  it('opens a project to both of its settings and saves them under the same keys', () => {
    const { updateSettings, view } = renderPane({
      forkMcpProfiles: {
        workers: { servers: [] }
      } as unknown as GlobalSettings['forkMcpProfiles']
    })
    fireEvent.click(screen.getByRole('button', { name: /project-3\b/ }))
    const row = view.container.querySelector<HTMLElement>('[data-fork-project-settings="repo-3"]')
    expect(row?.textContent).toContain('/home/test/code/project-3')
    expect(row?.textContent).toContain('MCP profile')
    expect(row?.textContent).toContain('Lost work default branch')
    expect(
      projectRows(view.container).filter((item) => item.textContent?.includes('MCP profile'))
    ).toHaveLength(1)

    const branch = within(row as HTMLElement).getByRole('textbox')
    fireEvent.change(branch, { target: { value: 'develop' } })
    fireEvent.blur(branch)
    expect(updateSettings).toHaveBeenCalledWith({
      forkLostWork: expect.objectContaining({ defaultBranches: { 'repo-3': 'develop' } })
    })
  })

  it('says what a closed project has set', () => {
    const { view } = renderPane({
      forkMcpProjectProfiles: [{ path: '/home/test/code/project-2', profile: 'none' }]
    })
    const row = view.container.querySelector('[data-fork-project-settings="repo-2"]')
    expect(row?.textContent).toContain('MCP: none')
    expect(
      view.container.querySelector('[data-fork-project-settings="repo-1"]')?.textContent
    ).toContain('Defaults')
  })

  it('filters the project list', () => {
    const { view } = renderPane()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter projects' }), {
      target: { value: 'project-29' }
    })
    expect(projectRows(view.container)).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter projects' }), {
      target: { value: 'nothing-like-this' }
    })
    expect(projectRows(view.container)).toHaveLength(0)
    expect(view.container.textContent).toContain('No project matches.')
  })
})

describe('fork settings navigation', () => {
  it('is one desktop pane that the jump palette can open', () => {
    const [section, ...rest] = buildForkSettingsNavSections({ isWebClient: false })
    expect(rest).toHaveLength(0)
    expect(section.id).toBe(FORK_SETTINGS_PANE_ID)
    expect(isSettingsNavigationTarget({ pane: section.id, repoId: null })).toBe(true)
    expect(buildForkSettingsNavSections({ isWebClient: true })).toEqual([])
  })

  it('has a search entry for every section and card, with no title twice', () => {
    const [section] = buildForkSettingsNavSections({ isWebClient: false })
    const titles = section.searchEntries.map((entry) => entry.title)
    expect(new Set(titles).size).toBe(titles.length)
    const sections = getForkSettingsSections()
    expect(titles).toHaveLength(sections.reduce((sum, item) => sum + 1 + item.entries.length, 0))
  })
})
