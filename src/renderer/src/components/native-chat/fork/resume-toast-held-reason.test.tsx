// @vitest-environment happy-dom
// BAD-799: a terminal worker Pause all held at restart says why in the restart toast's reason line.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatResumeToastRow } from '../../native-chat-recovery/toast/NativeChatResumeToastRow'

afterEach(cleanup)

it("shows the host's held reason as the offered worker's reason line", () => {
  const heldReason = 'Paused by pause-all at restart: `orca resume-all` resumes it.'
  render(
    <NativeChatResumeToastRow
      row={{
        state: 'needs-you',
        candidate: {
          sessionId: 'ctx_example',
          workspaceId: 'repo::/work/app',
          agent: 'codex',
          trigger: 'crash',
          latestPrompt: 'Build the parser.',
          recordedAt: 1,
          surface: 'terminal',
          activity: { state: 'working', prompts: [], tasks: [] },
          heldReason
        }
      }}
      name="Build the parser."
      age="1m"
      busy={false}
      remote={false}
      onAction={() => {}}
    />
  )
  expect(screen.getByText(heldReason).getAttribute('title')).toBe(heldReason)
})
