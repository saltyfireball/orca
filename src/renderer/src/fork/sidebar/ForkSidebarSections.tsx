import { ForkSnoozedSection } from '@/fork/snooze/ForkSnoozedSection'
import { ForkArchivedSection } from '@/fork/workspace-tags/ForkArchivedSection'

export { ForkTagFilterBar } from '@/fork/workspace-tags/ForkTagFilterBar'

/** The fork's sections under the project list, behind one hook in the sidebar so that upstream
 *  file stays under its line budget. */
export function ForkSidebarSections(): React.JSX.Element {
  return (
    <>
      <ForkSnoozedSection />
      <ForkArchivedSection />
    </>
  )
}
