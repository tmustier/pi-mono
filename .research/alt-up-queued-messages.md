# ALT+Up queued-message UX: Pi vs Codex

## Pi (pi-mono)
- Default keybinding maps `dequeue` to `alt+up` in app keybindings. (`packages/coding-agent/src/core/keybindings.ts:60`)
- `alt+up` is wired to `handleDequeue`, which restores all queued steering/follow-up messages into the editor via `restoreQueuedMessagesToEditor` and shows a status message. (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1369`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2150`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2333`)
- Pending queue UI shows queued items as `Steering:` / `Follow-up:` lines, but no inline hint for `alt+up`. (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:2310`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2323`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2327`)
- The hotkey is surfaced in the startup header and `/hotkeys` view, using generic key formatting (no mac-specific `⌥`). (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:424`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3326`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3414`)

## Codex (openai/codex)
- Alt+Up handling: when queued messages exist, `Alt+Up` pops the most recently queued message into the composer and leaves the rest queued. (`/Users/thomasmustier/codex/codex-rs/tui/src/chatwidget.rs:1621`)
- Queued messages preview is rendered above the composer; messages are indented, dim/italic, truncated to 3 lines, and a hint line is appended. (`/Users/thomasmustier/codex/codex-rs/tui/src/bottom_pane/mod.rs:567`, `/Users/thomasmustier/codex/codex-rs/tui/src/bottom_pane/queued_user_messages.rs:40`, `/Users/thomasmustier/codex/codex-rs/tui/src/bottom_pane/queued_user_messages.rs:51`)
- The hint uses `key_hint::alt(KeyCode::Up)` so macOS renders `⌥ + ↑`, while other platforms render `alt + ↑`. (`/Users/thomasmustier/codex/codex-rs/tui/src/key_hint.rs:10`, `/Users/thomasmustier/codex/codex-rs/tui/src/key_hint.rs:14`, `/Users/thomasmustier/codex/codex-rs/tui/src/bottom_pane/queued_user_messages.rs:51`)

## UX delta summary
- Pi only surfaces `alt+up` in the header and hotkeys menu; Codex adds an inline hint next to queued messages.
- Pi restores all queued messages at once; Codex restores only the most recent queued item.
- Pi shows `Alt+Up` text even on macOS; Codex switches to the `⌥` symbol on macOS.
