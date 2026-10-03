// tail-thinking: keeps the chain of thought to a rolling tail in the transcript.
// While the model is streaming its thinking, only the last 15 lines are shown
// (with a "… +N lines" header); the moment thinking ends — answer text or a
// tool call starts, or the message finalizes — the block collapses to a single
// dim line with the line count. Historical messages render collapsed too.
//
// Built on registerMarkdownTransformer, so it composes with click overrides:
// they replace the block entirely and bypass this transformer.
//
// Keys: Ctrl+O expands/collapses the CoT; Ctrl+T is disabled (pi's built-in
// hide-thinking toggle fights the display management here). Both keys are
// reserved by pi — registerShortcut alone cannot shadow them — so the user's
// keybindings.json must free them first:
//   { "app.thinking.toggle": [], "app.tools.expand": "alt+o" }
//
// /cot        — show current state and tail size
// /cot auto   — tail while thinking, collapse after (default)
// /cot full   — never collapse, always show full thinking
// /cot <N>    — tail size in lines, e.g. /cot 25 (default 15)

const DEFAULT_TAIL_LINES = 15;

let tailLines = DEFAULT_TAIL_LINES;
// false: rolling tail while thinking + one-line collapse after. true: full
// CoT everywhere, streaming included. Toggled by Ctrl+O, /cot full, /cot auto.
let expanded = false;

// True while the streaming assistant message's latest visible activity is a
// thinking block. Derived from message_update so the collapse lands as soon as
// the model starts answering, not only when the whole message finalizes.
// Per-message, not per-run: with interleaved thinking (run 1 done, run 2
// streaming) run 1 shows its tail until the message ends — cosmetic only.
let thinkingActive = false;

// "" for empty/invisible blocks, "thinking" for thinking content, "other" for
// answer text or tool calls.
function blockKind(block: unknown): "thinking" | "other" | "" {
	if (!block || typeof block !== "object") return "";
	const b = block as Record<string, any>;
	if (b.type === "thinking") return typeof b.thinking === "string" && b.thinking.trim() ? "thinking" : "";
	if (b.type === "text") return typeof b.text === "string" && b.text.trim() ? "other" : "";
	if (b.type === "toolCall") return "other";
	return "";
}

export default function (pi: any) {
	pi.on("message_update", (event: { message: { role: string; content?: unknown } }) => {
		if (event.message.role !== "assistant") return;
		let last = "";
		if (Array.isArray(event.message.content)) {
			for (const block of event.message.content) {
				const kind = blockKind(block);
				if (kind) last = kind;
			}
		}
		thinkingActive = last === "thinking";
	});

	pi.on("message_end", (event: { message: { role: string } }) => {
		if (event.message.role === "assistant") thinkingActive = false;
	});

	pi.registerMarkdownTransformer((markdown: string, context: { messageType: string; isStreaming: boolean }) => {
		if (context.messageType !== "assistant-thinking") return markdown;
		if (expanded) return markdown;

		const lines = markdown.split("\n");

		if (context.isStreaming && thinkingActive) {
			if (lines.length <= tailLines) return markdown;
			const hidden = lines.length - tailLines;
			return `… +${hidden} lines\n${lines.slice(-tailLines).join("\n")}`;
		}

		// Thinking finished (or historical render): collapse to one line.
		return `▸ thinking · ${lines.length} lines — collapsed`;
	});

	pi.registerShortcut("ctrl+o", {
		description: "Expand or collapse the CoT (tail-thinking)",
		handler: (ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => {
			expanded = !expanded;
			ctx.ui.notify(
				expanded
					? "tail-thinking: expanded — full CoT shown"
					: `tail-thinking: collapsed — last ${tailLines} lines while thinking, one line after`,
			);
		},
	});

	// Claim ctrl+t for this extension: with app.thinking.toggle unbound in the
	// user's keybindings.json, this registration takes the key. Without the
	// unbinding, pi skips the registration (reserved key) and ctrl+t stays
	// built-in — the hint explains that case.
	let ctrlTNotified = false;
	pi.registerShortcut("ctrl+t", {
		description: "Disabled by tail-thinking (it owns thinking display)",
		handler: (ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => {
			if (!ctrlTNotified) {
				ctrlTNotified = true;
				ctx.ui.notify("tail-thinking: Ctrl+T is disabled — thinking display is managed here (/cot for status)", "warning");
			}
		},
	});

	pi.registerCommand("cot", {
		description: "Chain-of-thought display: /cot [auto|full|<lines>]",
		handler: async (args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => {
			const arg = args.trim();
			if (!arg) {
				ctx.ui.notify(
					expanded
						? `tail-thinking: expanded — full CoT shown (/cot auto, or Ctrl+O, to restore tail+collapse)`
						: `tail-thinking: last ${tailLines} lines while thinking, collapsed after (Ctrl+O or /cot full to expand)`,
				);
				return;
			}
			if (arg === "auto" || arg === "full") {
				expanded = arg === "full";
				ctx.ui.notify(
					expanded
						? "tail-thinking: expanded — full CoT shown (no tail, no collapse)"
						: `tail-thinking: collapsed — last ${tailLines} lines while thinking, one line after`,
				);
				return;
			}
			const n = Number(arg);
			if (!Number.isInteger(n) || n < 1 || n > 200) {
				ctx.ui.notify(`tail-thinking: don't understand "${arg}" — use /cot auto|full|<lines 1-200>`, "error");
				return;
			}
			tailLines = n;
			ctx.ui.notify(`tail-thinking: tail set to ${n} lines (${expanded ? "expanded" : "collapsed"} state)`);
		},
	});
}
