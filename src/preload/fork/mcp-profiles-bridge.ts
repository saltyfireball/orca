// window.api.forkMcpProfiles: MCP servers and profiles for the settings pane and the chat header
// (FORK.md "MCP profiles").
import { ipcRenderer } from 'electron'
import {
  FORK_MCP_CHANNELS as CHANNELS,
  type ForkMcpProfilesApi
} from '../../shared/fork/mcp-profiles'

export const forkMcpProfilesApi: ForkMcpProfilesApi = {
  list: (folder) => ipcRenderer.invoke(CHANNELS.list, folder ?? ''),
  chat: (sessionId) => ipcRenderer.invoke(CHANNELS.chat, sessionId),
  setChat: (sessionId, profile) => ipcRenderer.invoke(CHANNELS.setChat, sessionId, profile)
}
