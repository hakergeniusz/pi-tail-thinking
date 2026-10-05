# pi-tail-thinking

Rolling chain-of-thought for [pi](https://github.com/earendil-works/pi): while
the model streams its thinking, only the **last 15 lines** stay on screen; the
moment it stops thinking, the block collapses to one dim line —
``▸ thinking · 57 lines — collapsed (`ctrl+t` to collapse)`` (blocks of ≤5
lines stay as-is: a label would be nearly as long as the content). Purely a
display filter: nothing is removed from the session, and the full CoT is
always one keypress away.

## Why

Long thinking streams flood the transcript: by the time the answer arrives,
the reasoning you wanted to watch has scrolled away, and finished messages
keep every line of CoT forever. A rolling tail keeps the live view readable,
and the collapse keeps finished turns to a single line.

## Commands and keys

| Input | What it does |
|---|---|
| `Ctrl+T` | Show or hide thinking blocks |
| `/cot` | Show current state and tail size |
| `/cot show` / `/cot hide` | Display or hide thinking blocks (same as Ctrl+T) |
| `/cot auto` | Default: last N lines while thinking, collapsed after (N = 15) |
| `/cot full` | Never tail, never collapse — full thinking everywhere |
| `/cot <N>` | Tail size in lines, e.g. `/cot 25` (1–200) |

While thinking is hidden, every block renders as one dim
``▸ thinking hidden (`ctrl+t` to expand)`` line; pi's per-block click
override still reveals a single block.

`Ctrl+T` is a **reserved** key in pi — an extension cannot shadow it with
`registerShortcut` alone. To hand it over, free `app.thinking.toggle` in
`~/.pi/agent/keybindings.json`:

```json
{
	"app.thinking.toggle": []
}
```

Without that file the extension still works; Ctrl+T keeps pi's built-in
thinking toggle, which does the same thing.

`Alt+O` used to expand and collapse the CoT. It was removed so the only
thinking-related keys are `shift+tab` (pi's cycle) and `ctrl+t`. Switch between
tail and full CoT with `/cot auto` and `/cot full`.

## How it works

Two hooks, no payload changes — the model sees exactly what pi built:

- `registerMarkdownTransformer` scoped to `assistant-thinking` blocks. While
  the block streams, it returns the last N lines with a `… +N lines` header;
  once thinking is over it returns the one-line collapsed label (blocks of
  ≤5 lines pass through untouched). Mouse-click visibility overrides replace
  the block entirely and bypass the extension.
- `registerShortcut` claims `ctrl+t` (show/hide thinking); extension
  shortcuts dispatch before pi's built-in keybindings. Toggling calls
  `ctx.ui.setHiddenThinkingLabel()` — pi has no
  direct re-render API, but this rebuilds every rendered assistant message,
  so already-shown blocks immediately follow the new state instead of staying
  stale until they are re-rendered.
- `message_update` / `message_end` track whether the streaming message's
  latest visible activity is still a thinking block, so the collapse lands as
  soon as the answer starts — not when the whole turn finalizes.

Settings are per-session (not persisted); edit the `DEFAULT_TAIL_LINES`
constant if you want a different default.

## Install

```bash
pi install git:github.com/hakergeniusz/pi-tail-thinking
```

Try it without installing:

```bash
pi -e https://github.com/hakergeniusz/pi-tail-thinking
```

Or copy `index.ts` anywhere and load it with `pi -e ./index.ts`.

## Test

```bash
bun test.ts
```

## License

MIT
