// Clear the launching terminal’s inherited Orca identity so test branches depend on fixture env, not which agent launched runner.
// Clear the launching terminal's identity too: macOS /etc/zshrc and /etc/bashrc source /etc/{zsh,bash}rc_$TERM_PROGRAM.
for (const name of [
  'ORCA_AGENT_SESSION_ID',
  'ORCA_STRUCTURED_SESSION',
  'ORCA_WORKTREE_ID',
  'ORCA_WORKSPACE_ID',
  'ORCA_RUNTIME_SOURCE_ID',
  'ORCA_RUNTIME_SOURCE_INCARNATION',
  'ORCA_RUNTIME_SOURCE_PROFILE_PATH',
  // Live-session variables an Orca terminal exports: a test run from inside one must see none.
  'ORCA_TERMINAL_HANDLE',
  'ORCA_AGENT_SESSION_SPAWN_TOKEN',
  'ORCA_CLI_COMMAND',
  'ORCA_CLI_BIN_DIR',
  'ORCA_APP_VERSION',
  'ORCA_USER_DATA_PATH',
  'ORCA_PAIRING_CODE',
  'ORCA_REMOTE_PAIRING',
  'ORCA_ENVIRONMENT',
  'ORCA_CHAT_SCRATCH_DIR',
  'ORCA_CLAUDE_PROFILE_POINTER',
  'ORCA_CLAUDE_INJECTED_CONFIG_DIR',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID'
]) {
  delete process.env[name]
}
