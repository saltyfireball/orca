# Custom app themes (Blackfish)

Settings > Appearance > Custom app themes loads a whole app theme from pasted text or a file.
A theme can recolor the app chrome, the terminal, the corner radius and the UI font. Saving a
theme changes nothing. Use paints it, and Reset to default puts the stock colors and the earlier
terminal theme back.

Code: `src/shared/fork/custom-app-theme/` (format, importers, settings writes) and
`src/renderer/src/fork/custom-app-theme/` (settings UI and the paint hook).

## The format

A theme is one JSON object.

| Key                           | Required                               | What it is                                                                                                                                                          |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                        | no                                     | Shown in the saved list. Up to 80 characters. Defaults to "Custom theme".                                                                                           |
| `base`                        | yes, unless `tokens.background` is set | `"dark"` or `"light"`: the mode the theme belongs to, and the stock colors used for any token it leaves out. When missing, Orca reads it from the background color. |
| `tokens`                      | yes, unless `terminal` is set          | App colors by token name, with or without the leading `--`.                                                                                                         |
| `terminal`                    | no                                     | Terminal colors, see below.                                                                                                                                         |
| `font`                        | no                                     | One UI font family name, like `"Inter"`. Letters, digits, spaces, dots, dashes and underscores only.                                                                |
| `radius`                      | no                                     | Corner radius, up to `32px` or `2rem`. A bare number is pixels.                                                                                                     |
| `author`, `license`, `source` | no                                     | Kept with the theme and written back on export.                                                                                                                     |
| `$schema`, `schemaVersion`    | no                                     | Ignored.                                                                                                                                                            |

Unknown keys and unknown token names are ignored with a warning. A token the theme leaves out
keeps the base theme's color. When a theme sets both `background` and `foreground`, Orca derives
the tokens it leaves out from them, the same way it does for plugin themes.

### Tokens

The tokens are the public app theme tokens plugin themes use (`PLUGIN_APP_THEME_TOKENS` in
`src/shared/plugins/artifacts/plugin-theme-artifact.ts`):

- Surfaces: `background`, `editor-surface`, `foreground`, `card`, `card-foreground`, `popover`,
  `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`,
  `muted`, `muted-foreground`, `accent`, `accent-foreground`, `border`, `input`, `ring`.
- Charts: `chart-1` to `chart-5`.
- Sidebars: `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`,
  `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`, and the same
  set as `worktree-sidebar-*`, plus `worktree-sidebar-active` and `worktree-sidebar-active-border`.
- Tabs and splits: `host-badge`, `host-badge-foreground`, `tab-bar`, `tab-active`,
  `tab-active-foreground`, `tab-active-indicator`, `tab-inactive`, `tab-inactive-foreground`,
  `split-divider`, `split-divider-hover`.
- Chat: `chat-user-message`, `chat-bold-foreground`, `chat-muted-foreground`, `chat-inline-code`,
  `chat-inline-code-foreground`, `chat-code-block`, `chat-selection`,
  `chat-selection-foreground`, `text-link`.
- Diffs and git: `diff-added`, `diff-added-background`, `diff-added-emphasis`,
  `diff-added-gutter`, the same four for `diff-removed`, and `git-decoration-added`, `-modified`,
  `-deleted`, `-renamed`, `-untracked`, `-ignored`.

### Colors

A color is one of:

- hex: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the `#` may be left out);
- `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()` or `oklch()` of
  plain numbers;
- a CSS color name, like `rebeccapurple`.

Nothing else is accepted: no `var()`, `url()`, `calc()`, `color-mix()`, keywords like
`transparent` or `inherit`, or anything longer than 64 characters. Orca also skips any app color
that would leave text unreadable, as it does for plugin themes.

### Terminal

`terminal` takes hex colors only:

- `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground`,
  `selectionForeground` (`selection` and `cursorColor` also work);
- the 16 ANSI colors by name (`black`, `red`, ... `brightWhite`), or a `palette` array of up
  to 16 in ANSI order.

Terminal colors need a background, a foreground and at least one ANSI color, or they are left
out with a warning. ANSI colors the theme leaves out keep the stock terminal colors.

When you Use a theme with the "Also use the theme's terminal colors" box ticked, its terminal
colors become a stock custom terminal theme (Settings > Terminal shows it) selected for the
theme's mode. For a light theme that also turns on the separate light terminal theme. Reset and
Delete put the terminal theme you had before back.

### Limits

Pasted or imported text is at most 64 KB, a theme has at most 256 tokens, and you can save up to
50 themes.

## Importers

The same box reads these formats and derives the app colors from their palette:

- **Ghostty** theme files (`palette = N=#hex`, `background`, `foreground`, `cursor-color`,
  `selection-background`, `selection-foreground`).
- **Warp** themes (YAML or JSON with `accent`, `background`, `foreground` and
  `terminal_colors.normal` / `.bright`). A gradient uses its `top` color.
- **base16 and base24** schemes, YAML or JSON, flat (`base00` ...) or under `palette:`. base24
  is detected by `base12` to `base17`, which give the bright colors.

The importers map the background and foreground to the app background and text, the accent
(Warp's `accent`, base16 `base0D`, else ANSI blue) to primary, rings and the tab indicator, the
surface (base16 `base01`, else a mix of background and text) to sidebars, popovers and tab bars,
the selection to the chat selection, dim text (base16 `base04`, else bright black) to muted text,
and the ANSI colors to diffs, git marks and charts. Dim text below 3.5:1 contrast with the
background is swapped for a 62% mix of text into background, so muted text stays readable.

## Example: cyberdream

`docs/fork/custom-app-themes/cyberdream.json`, also behind "Load example" in the settings. The
colors are from [cyberdream](https://github.com/scottmckendry/cyberdream.nvim) by Scott McKendry,
MIT License, Copyright (c) 2023 Scott McKendry.

```json
{
  "name": "cyberdream",
  "base": "dark",
  "author": "Scott McKendry",
  "license": "MIT License, Copyright (c) 2023 Scott McKendry",
  "source": "https://github.com/scottmckendry/cyberdream.nvim",
  "radius": "0.5rem",
  "tokens": {
    "background": "#16181a",
    "foreground": "#ffffff",
    "editor-surface": "#16181a",
    "card": "#16181a",
    "popover": "#1e2124",
    "primary": "#5ea1ff",
    "primary-foreground": "#16181a",
    "secondary": "#1e2124",
    "muted": "#1e2124",
    "muted-foreground": "#7b8496",
    "accent": "#3c4048",
    "accent-foreground": "#ffffff",
    "border": "#3c4048",
    "input": "#3c4048",
    "ring": "#5ea1ff",
    "sidebar": "#1e2124",
    "sidebar-foreground": "#ffffff",
    "tab-bar": "#1e2124",
    "tab-active": "#16181a",
    "tab-active-foreground": "#ffffff",
    "tab-active-indicator": "#5ef1ff",
    "tab-inactive": "#1e2124",
    "tab-inactive-foreground": "#7b8496",
    "split-divider": "#3c4048",
    "split-divider-hover": "#5ea1ff",
    "chat-user-message": "#1e2124",
    "chat-inline-code": "#3c4048",
    "chat-inline-code-foreground": "#5ef1ff",
    "chat-code-block": "#1e2124",
    "chat-selection": "#3c4048",
    "text-link": "#5ea1ff",
    "diff-added": "#5eff6c",
    "diff-removed": "#ff6e5e",
    "git-decoration-added": "#5eff6c",
    "git-decoration-modified": "#ffbd5e",
    "git-decoration-deleted": "#ff6e5e",
    "git-decoration-renamed": "#5ef1ff",
    "git-decoration-untracked": "#5eff6c",
    "git-decoration-ignored": "#7b8496",
    "chart-1": "#5ea1ff",
    "chart-2": "#5eff6c",
    "chart-3": "#f1ff5e",
    "chart-4": "#ff5ef1",
    "chart-5": "#5ef1ff"
  },
  "terminal": {
    "background": "#16181a",
    "foreground": "#ffffff",
    "cursor": "#ffffff",
    "selectionBackground": "#3c4048",
    "selectionForeground": "#ffffff",
    "palette": [
      "#16181a",
      "#ff6e5e",
      "#5eff6c",
      "#f1ff5e",
      "#5ea1ff",
      "#bd5eff",
      "#5ef1ff",
      "#ffffff",
      "#3c4048",
      "#ff6e5e",
      "#5eff6c",
      "#f1ff5e",
      "#5ea1ff",
      "#bd5eff",
      "#5ef1ff",
      "#ffffff"
    ]
  }
}
```
