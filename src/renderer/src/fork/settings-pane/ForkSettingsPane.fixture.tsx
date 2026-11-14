import { defineFixture } from '../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Repo } from '../../../../shared/repo-types'
import { ForkProjectSettingsList } from './ForkProjectSettingsList'
import { ForkSettingsPane } from './ForkSettingsPane'

const repos = Array.from({ length: 30 }, (_, index) => ({
  id: `repo-${index + 1}`,
  path: `/home/test/code/project-${index + 1}`,
  displayName: `project-${index + 1}`,
  badgeColor: '#888888',
  addedAt: 0
})) as unknown as Repo[]

const settings = {
  ...getDefaultSettings('/home/test'),
  forkMcpProjectProfiles: [{ path: '/home/test/code/project-2', profile: 'none' }]
}

/** The whole pane with thirty projects: the project list stays one short, closed block. */
export const manyProjects = defineFixture({
  width: 760,
  store: { settings, repos },
  render: () => <ForkSettingsPane settings={settings} updateSettings={() => {}} />
})

/** The project list alone: thirty projects, every one closed, in a block of fixed height. */
export const projectList = defineFixture({
  width: 760,
  store: { settings, repos },
  render: () => <ForkProjectSettingsList settings={settings} updateSettings={() => {}} />
})
