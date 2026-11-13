// FORK.md "MCP profiles": the automation launcher's hook. An automation's chat is a background
// launch, so it takes the background default unless a profile is chosen for it later.
import { launchAgentOnHost } from '../../runtime/rpc/methods/agent-launch/agent-launch'
import { runInForkMcpLaunchScope } from './mcp-launch-scope'

export const launchBackgroundAgentOnHost: typeof launchAgentOnHost = (...args) =>
  runInForkMcpLaunchScope({ kind: 'background' }, () => launchAgentOnHost(...args))
