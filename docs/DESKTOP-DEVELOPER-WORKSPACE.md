# Desktop repository tools

Relay's native desktop now keeps repository tools in a compact bottom bar. It uses the existing PaceUI interface and the same case history as the web app. These tools remain available when the local case service is offline.

## Use the desktop

Build with `make desktop-build`, then open `target/debug/bundle/macos/Repro Relay.app` on this Mac.

- **Open repository** chooses a Git checkout through the native folder picker. Relay remembers its root in the desktop application's configuration directory.
- **Repository tools**, or **Cmd/Ctrl+J**, expands or closes the panel. **Cmd/Ctrl+Shift+O** opens the repository picker.
- **Changes** shows Git's tracked-file status. Untracked files and submodule contents are excluded. The timestamp describes the last snapshot; use Refresh Git after editing.
- **Worktrees** lists existing checkouts, paths, branches and commit identifiers. Detached checkouts remain explicitly labeled.
- **Open terminal** opens macOS Terminal in the selected directory. It does not send a command or start Hermes. Native terminal launching on Windows and Linux is not implemented.
- **Connection** distinguishes the local workspace service from Hermes runtime availability. Ready means the runtime can accept work, not that an investigation is running. Agent controls holds the actual run history.

Opening a repository changes native inspection and terminal location only. It does not change a case's target or authorize edits. Repair worktrees still use the versioned case plan and terminal commands described in [Relay from your terminal](../integrations/relay-terminal/README.md). This panel lists existing worktrees; it does not create or approve them.

The native bridge accepts no shell command or caller-supplied repository path. It uses the folder picker or a previously saved selection. Git reads have an eight-second timeout and 128 KiB output limit per invocation. Status inspection disables filesystem-monitor hooks and configured content filters. No source files are edited by these controls. Large or inaccessible repositories produce an error instead of an invented clean state.

The terminal is a separate application. An embedded PTY, file editor, candidate diff viewer, automatic service startup and a Hermes execution adapter remain separate work. Account management continues in the browser. The native folder does not yet become a shared remote workspace.

## Kiro Crew reference

The supplied recording on September 14 is approximately 24 seconds long and shows Kiro Crew. It was reviewed locally; the video and extracted frames are not committed. Observations below describe visible behavior, not a claim about its entire implementation.

| Visible pattern in the recording | Relay application |
| --- | --- |
| Session list stays beside the active conversation | Preserve saved investigation/history selection beside evidence. A full conversation-and-work desktop layout remains next. |
| Short Thinking and Needs approval labels | Use concise runtime states; show detailed reason and scope on demand. |
| Persistent Terminal entry | Native repository bar with a direct terminal handoff and keyboard shortcuts. |
| Compact connection indicators | Separate local-service and Hermes availability. Text accompanies state indicators. |
| Details and actions appear in place | Expandable repository panel with Changes, Worktrees and Connection. |
| Brief transitions retain the surrounding layout | Use a 160 ms opacity/translation entry and existing button feedback. Reduced motion removes panel animation. This timing is Relay's choice, not a measurement of Kiro Crew. |

[Kiro Crew's repository](https://github.com/kirodotdev/KiroCrew) describes a persistent workspace across desktop, web and CLI, including a managed gateway. Relay currently shares backend case records across entry points but still runs its service separately. The broader [Kiro workflow documentation](https://kiro.dev/docs/how-kiro-works/) also informed the separation between shared agent configuration and interface-specific tools. No Kiro source or assets were copied.

## Validation

Native Rust tests create temporary Git repositories and detached worktrees, inspect tracked changes, reject non-repositories and oversized output, and verify that a configured clean filter does not execute during inspection. Browser fixtures simulate the native bridge and exercise folder selection, worktree display, terminal handoff, offline service states, refresh, keyboard collapse and minimum desktop width. Those fixtures do not establish native OS dialog or terminal-window behavior.

The release checks include `make check`, `cargo test -p relay-desktop`, `cargo clippy -p relay-desktop --all-targets -- -D warnings`, and `make desktop-build`. Windows/Edge, physical-device interaction, screen-reader operation and native UI automation require separate validation.
