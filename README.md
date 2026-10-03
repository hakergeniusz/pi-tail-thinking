# pi-cot-tail

Rolling chain-of-thought for [pi](https://github.com/earendil-works/pi): while
the model streams its thinking, only the **last 15 lines** stay on screen; the
moment it stops thinking, the block collapses to one dim line —
`▸ thinking · 57 lines — collapsed`. Purely a display filter: nothing is
removed from the session, and the full CoT is always one command away.

## Why

Long thinking streams flood the transcript: by the time the answer arrives,
the reasoning you wanted to watch has scrolled away, and finished messages
keep every line of CoT forever. A rolling tail keeps the live view readable,
and the collapse keeps finished turns to a single line.

## Commands

| Command | What it does |
|---|---|
| `/cot` | Show current mode and tail size |
| `/cot auto` | Default: last N lines while thinking, collapsed after (N = 15) |
| `/cot full` | Never tail, never collapse — full thinking everywhere |
| `/cot <N>` | Tail size in lines, e.g. `/cot 25` (1–200) |

## How it works

Two hooks, no payload changes — the model sees exactly what pi built:

- `registerMarkdownTransformer` scoped to `assistant-thinking` blocks. While
  the block streams, it returns the last N lines with a `… +N lines` header;
  once thinking is over it returns the one-line collapsed label. The
  transformer composes with pi's built-in thinking controls: Ctrl+T (hide
  thinking) and mouse-click visibility overrides replace the block entirely
  and bypass the extension.
- `message_update` / `message_end` track whether the streaming message's
  latest visible activity is still a thinking block, so the collapse lands as
  soon as the answer starts — not when the whole turn finalizes.

Settings are per-session (not persisted); edit the `DEFAULT_TAIL_LINES`
constant if you want a different default.

## Install

```bash
pi install git:github.com/hakergeniusz/pi-cot-tail
```

Try it without installing:

```bash
pi -e https://github.com/hakergeniusz/pi-cot-tail
```

Or copy `index.ts` anywhere and load it with `pi -e ./index.ts`.

## Test

```bash
bun test.ts
```

## License

MIT
