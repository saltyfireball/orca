// Fork settings catalog (FORK.md): the hand-kept half of the catalog. The type reader supplies
// every key, its value type and its doc comment; this file says which area a key belongs to
// and gives a description to the keys whose type has no doc comment.

/** Areas in the order `orca settings list` and `export` show them. First match wins. */
export const AREAS = [
  { id: 'terminal', title: 'Terminal', match: /^(terminal|floatingTerminal|primarySelection)/ },
  {
    id: 'editor',
    title: 'Editor and diffs',
    match:
      /^(editor|diff|markdown|richMarkdown|combinedDiff|codeFont|showGitIgnored|followSymlinked)/
  },
  {
    id: 'appearance',
    title: 'Appearance and window',
    match:
      /^(theme|appFont|appIcon|leftSidebar|rightSidebar|window|reduceVisual|uiLanguage|pluginAppTheme|pluginIconTheme|forkCustomAppTheme|forkAgentStateColors|show[A-Z]|compactWorktreeCards|minimizeToTray|confirmClose|ctrlTab|tabAuto|notifications$|localhostWorktreeLabels)/
  },
  { id: 'chat', title: 'Native chat', match: /^(nativeChat|forkChat|forkCache|promptCache)/ },
  { id: 'fork', title: 'Fork features', match: /^fork/ },
  {
    id: 'agents',
    title: 'Agents and accounts',
    match:
      /^(agent|claude|codex|gemini|minimax|zcode|opencode|antigravity|active(Claude|Codex)|defaultTuiAgent|disabledTuiAgents|nestedWorker|orchestration|local(Account|Agent|Windows)|computerAwake|keepComputerAwake|skipCodex|dismissedSkill)/
  },
  {
    id: 'source-control',
    title: 'Source control and tasks',
    match:
      /^(sourceControl|commitMessageAi|branchPrefix|autoRename|github|gitlab|prBot|jira|defaultTask|visibleTask|defaultLinear|defaultRepo|refreshLocalBase|localBaseRef)/
  },
  {
    id: 'workspaces',
    title: 'Workspaces and worktrees',
    match:
      /^(workspaceDir|nestWorkspaces|newWorkspace|worktree|alwaysForceDelete|skipDelete|skipClose|hostSettingOverrides|activeRuntimeEnvironment|machineName|openInApplications)/
  },
  {
    id: 'browser',
    title: 'Browser',
    match: /^(browser|openLinks|desktopBrowser)/
  },
  {
    id: 'plugins',
    title: 'Plugins',
    match: /^(plugin|devPlugin|disabledPlugins|themeBeforePlugin)/
  },
  { id: 'mobile', title: 'Mobile and emulators', match: /^(mobile|android|experimentalMobile)/ },
  {
    id: 'network',
    title: 'Network, updates and privacy',
    match: /^(httpProxy|nodeDistMirror|electronHttp1|telemetry|updateDelay|sshRemote)/
  },
  { id: 'experimental', title: 'Experimental', match: /^experimental/ },
  { id: 'general', title: 'General', match: /./ }
]

export function areaOf(key) {
  return AREAS.find((area) => area.match.test(key)).id
}

/** Descriptions for keys whose type carries no doc comment. A key with neither fails the build. */
export const DESCRIPTIONS = {
  activeClaudeManagedAccountId: 'The managed Claude account in use; null means the system login.',
  activeClaudeManagedAccountIdsByRuntime:
    'The managed Claude account in use for each local runtime (host and WSL).',
  activeCodexManagedAccountId: 'The managed Codex account in use; null means the system login.',
  activeCodexManagedAccountIdsByRuntime:
    'The managed Codex account in use for each local runtime (host and WSL).',
  agentLaunchChoices: 'Model, effort and mode picked per agent for new launches.',
  antigravityChatAuth: 'How Antigravity chat signs in; set through its account setup.',
  appFontFamily: 'Font family of the app interface; empty means the built-in font.',
  appIcon: 'Which app icon the dock or taskbar shows.',
  branchPrefix: 'Prefix for new branch names: the git user name, a custom text, or none.',
  branchPrefixCustom: 'The custom branch prefix used when branchPrefix is "custom".',
  claudeSubagentNavigationEnabled: 'Show Claude subagents as rows you can open.',
  combinedDiffFileTreeVisibleByDefault: 'Show the file tree when a combined diff opens.',
  diffDefaultView: 'Whether diffs open inline or side by side.',
  diffShowWhitespace: 'Show whitespace-only changes in diffs.',
  diffWordWrap: 'Wrap long lines in diffs.',
  editorAutoSave: 'Save edited files without asking.',
  editorAutoSaveDelayMs: 'Milliseconds after the last edit before auto save writes the file.',
  editorFormatOnSave: 'Format a file when it is saved.',
  editorInsertFinalNewline: 'End saved files with a newline.',
  editorMinimapEnabled: 'Show the minimap in the editor.',
  experimentalMobile: 'Turn on the mobile companion features.',
  followSymlinkedDirectories: 'Follow symlinked folders in the file tree.',
  forkMemoryPauseLaunches: 'Pause queued agent launches while memory pressure is high.',
  forkMemoryPollSeconds: 'Seconds between memory readings.',
  forkMemoryWarnPressure: 'Memory pressure level that raises the warning.',
  forkMemoryWarnSwapGb: 'Swap in use, in GB, that raises the memory warning.',
  leftSidebarTintColor: 'Tint color of the left sidebar.',
  leftSidebarTintOpacity: 'Strength of the left sidebar tint, from 0 to 1.',
  localAccountWslDistro: 'WSL distribution used for accounts when the account runtime is WSL.',
  localAgentWslDistro: 'WSL distribution agents run in when the agent runtime is WSL.',
  mobileEmulatorOpeningMode: 'Where a mobile emulator opens.',
  mobileEmulatorRecentDevices: 'Emulator devices opened recently, newest first.',
  nativeChatAppearance: 'Fonts, sizes and colors of native chat.',
  nestWorkspaces: 'Put each workspace in a folder named after its repo.',
  newWorkspaceSetupOnly: 'Open new workspaces with the setup step only, with no agent started.',
  notifications: 'Which events raise a notification and how.',
  refreshLocalBaseRefOnWorktreeCreate: 'Update the local base branch before a worktree is made.',
  showGitIgnoredFiles: 'Show files that git ignores in the file tree.',
  terminalActivePaneOpacity: 'Opacity of the focused terminal pane, from 0 to 1.',
  terminalBackgroundOpacity: 'Opacity of the terminal background, from 0 to 1.',
  terminalCursorBlink: 'Blink the terminal cursor.',
  terminalCursorOpacity: 'Opacity of the terminal cursor, from 0 to 1.',
  terminalCursorStyle: 'Shape of the terminal cursor.',
  terminalCustomThemes: 'Terminal color themes you added.',
  terminalDividerColorDark: 'Color of the line between terminal panes in dark mode.',
  terminalDividerColorLight: 'Color of the line between terminal panes in light mode.',
  terminalDividerThicknessPx: 'Thickness in pixels of the line between terminal panes.',
  terminalFastScrollSensitivity: 'Scroll speed multiplier while the fast-scroll key is held.',
  terminalFocusFollowsMouse: 'Focus a terminal pane when the pointer moves over it.',
  terminalFontFamily: 'Font family of terminal text.',
  terminalFontSize: 'Font size of terminal text.',
  terminalFontWeight: 'Font weight of normal terminal text.',
  terminalFontWeightBold: 'Font weight of bold terminal text.',
  terminalInactivePaneOpacity: 'Opacity of terminal panes that are not focused, from 0 to 1.',
  terminalLineHeight: 'Line height of terminal text, as a multiple of the font size.',
  terminalMouseHideWhileTyping: 'Hide the pointer over a terminal while you type.',
  terminalPaddingX: 'Space in pixels left and right of terminal text.',
  terminalPaddingY: 'Space in pixels above and below terminal text.',
  terminalPaneOpacityTransitionMs: 'Milliseconds a pane takes to fade when focus moves.',
  terminalQuickCommands: 'Saved commands and prompts offered in the terminal quick menu.',
  terminalScrollSensitivity: 'Scroll speed multiplier in terminals.',
  terminalScrollbackRows: 'Rows of history each terminal keeps.',
  terminalThemeDark: 'Terminal color theme in dark mode.',
  terminalThemeLight: 'Terminal color theme in light mode.',
  terminalTuiScrollSensitivity: 'Scroll speed multiplier inside full-screen terminal apps.',
  terminalUseSeparateLightTheme: 'Use terminalThemeLight in light mode instead of one theme.',
  terminalWordSeparator: 'Characters that end a word when you double-click terminal text.',
  theme: 'App color mode: follow the system, light or dark.',
  uiLanguage: 'Language of the app interface.',
  uiLanguagePortugueseMigrationApplied: 'One-time marker for the Portuguese language migration.',
  workspaceDir: 'Folder that holds new workspaces.',
  workspaceDirHistory: 'Workspace folders used before, so their worktrees stay listed.'
}
