# pi-tail-thinking

Rolling chain-of-thought for [pi](https://github.com/earendil-works/pi): while
the model streams its thinking, only the **last 15 lines** stay on screen; the
moment it stops thinking, the block collapses to one dim line —
``▸ thinking · 57 lines — collapsed (`ctrl+t` to expand)`` (blocks of ≤5
lines stay as-is: a label would be nearly as long as the content). Purely a
display filter: nothing is removed from the session, and the full CoT is
always one keypress away.

`Ctrl+T` is the only control, and it toggles between exactly two states:

- **tail** (default) — last 15 lines while thinking, one-line collapse after;
- **full** — thinking shown in full, streaming and finished.

No third state, no separate command: one key, one meaning.

## Why

Long thinking streams flood the transcript: by the time the answer arrives,
the reasoning you wanted to watch has scrolled away, and finished messages
keep every line of CoT forever. A rolling tail keeps the live view readable,
and the collapse keeps finished turns to a single line.

## Commands and keys

| Input | What it does |
|---|---|
| `Ctrl+T` | Toggle: full thinking, or last 15 lines + collapse |
| `/cot` | Show current state and tail size |
| `/cot <N>` | Tail size in lines, e.g. `/cot 25` (1–200) |

Mode is set by `Ctrl+T` only — `/cot` never switches it.

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
thinking-related keys are `shift+tab` (pi's cycle) and `ctrl+t`. `ctrl+t`
also owns the tail/full switch, so no command duplicates it.

## How it works

Two hooks, no payload changes — the model sees exactly what pi built:

- `registerMarkdownTransformer` scoped to `assistant-thinking` blocks. While
  the block streams, it returns the last N lines with a `… +N lines` header;
  once thinking is over it returns the one-line collapsed label (blocks of
  ≤5 lines pass through untouched). Mouse-click visibility overrides replace
  the block entirely and bypass the extension.
- `registerShortcut` claims `ctrl+t` (toggle full/tail thinking); extension
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
