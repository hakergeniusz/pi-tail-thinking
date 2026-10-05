// tail-thinking: keeps the chain of thought to a rolling tail in the transcript.
// While the model is streaming its thinking, only the last 15 lines are shown
// (with a "… +N lines" header); the moment thinking ends — answer text or a
// tool call starts, or the message finalizes — the block collapses to a single
// dim line with the line count. Short blocks (≤5 lines) stay as-is: the label
// would be nearly as long as the content. Historical messages render collapsed
// too.
//
// Built on registerMarkdownTransformer, so it composes with click overrides:
// they replace the block entirely and bypass this transformer.
//
// Keys: Ctrl+T shows/hides thinking blocks. That is the only key this
// extension claims; Alt+O used to expand/collapse the CoT and was removed so
// the thinking-related keys stay at shift+tab (pi's cycle) and ctrl+t. Use
// /cot full and /cot auto to switch between full CoT and the tail.
//
// /cot           — show current state
// /cot show|hide — display or hide thinking blocks (same as Ctrl+T)
// /cot auto      — tail while thinking, collapse after (default)
// /cot full      — never collapse, always show full thinking
// /cot <N>       — tail size in lines, e.g. /cot 25 (default 15)

const DEFAULT_TAIL_LINES = 15;
// Finished/historical thinking blocks with at most this many lines are left
// untouched — collapsing a 3-line thought into a label hides content while
// saving two lines.
const SHORT_BLOCK_LINES = 5;

let tailLines = DEFAULT_TAIL_LINES;
// false: rolling tail while thinking + one-line collapse after. true: full
// CoT everywhere, streaming included. Set by /cot full and /cot auto.
let expanded = false;
// true: thinking blocks render as a single "hidden" line (Ctrl+T is ignored
// while hidden). Toggled by Ctrl+T, /cot hide, /cot show. Session-only, like
// everything else here.
let hidden = false;

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
		// Hidden wins over everything: one dim placeholder line, streaming or
		// not. pi's per-block click overrides still bypass this and reveal the
		// raw block.
		if (hidden) return "▸ thinking hidden (`ctrl+t` to expand)";
		if (expanded) return markdown;

		const lines = markdown.split("\n");

		if (context.isStreaming && thinkingActive) {
			if (lines.length <= tailLines) return markdown;
			const hiddenCount = lines.length - tailLines;
			return `… +${hiddenCount} lines\n${lines.slice(-tailLines).join("\n")}`;
		}

		// Thinking finished (or historical render): collapse to one line — but
		// leave short blocks alone, the label would be nearly as long as the
		// content.
		if (lines.length <= SHORT_BLOCK_LINES) return markdown;
		return `▸ thinking · ${lines.length} lines — collapsed (\`ctrl+t\` to collapse)`;
	});

	// pi has no direct "re-render the transcript" API for extensions, but
	// setHiddenThinkingLabel() (no args = restore the default label) rebuilds
	// every rendered assistant message, re-running the transformer with the
	// current state. Without this, toggling would only affect future blocks —
	// "expanded" would claim full CoT while everything on screen stays
	// collapsed. No-op outside the TUI.
	function rerenderTranscript(ctx: { ui: { setHiddenThinkingLabel?: (label?: string) => void } }) {
		ctx.ui.setHiddenThinkingLabel?.();
	}

	// Claim ctrl+t for this extension: with app.thinking.toggle unbound in the
	// user's keybindings.json, this registration takes the key. Without the
	// unbinding, pi skips the registration (reserved key) and ctrl+t stays
	// pi's built-in thinking toggle.
	pi.registerShortcut("ctrl+t", {
		description: "Show or hide thinking blocks (tail-thinking)",
		handler: (ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void; setHiddenThinkingLabel?: (label?: string) => void } }) => {
			hidden = !hidden;
			rerenderTranscript(ctx);
			ctx.ui.notify(hidden ? "tail-thinking: thinking hidden" : "tail-thinking: thinking visible");
		},
	});

	pi.registerCommand("cot", {
		description: "Chain-of-thought display: /cot [show|hide|auto|full|<lines>]",
		handler: async (args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void; setHiddenThinkingLabel?: (label?: string) => void } }) => {
			const arg = args.trim();
			if (!arg) {
				const mode = hidden ? "thinking hidden" : expanded ? "full CoT" : `tail ${tailLines} lines, collapsed after`;
				ctx.ui.notify(`tail-thinking: ${mode} (Ctrl+T hide/show)`);
				return;
			}
			if (arg === "hide" || arg === "show") {
				hidden = arg === "hide";
				rerenderTranscript(ctx);
				ctx.ui.notify(hidden ? "tail-thinking: thinking hidden" : "tail-thinking: thinking visible");
				return;
			}
			if (arg === "auto" || arg === "full") {
				expanded = arg === "full";
				rerenderTranscript(ctx);
				ctx.ui.notify(expanded ? "tail-thinking: expanded" : `tail-thinking: collapsed (tail ${tailLines})`);
				return;
			}
			const n = Number(arg);
			if (!Number.isInteger(n) || n < 1 || n > 200) {
				ctx.ui.notify(`tail-thinking: don't understand "${arg}" — use /cot show|hide|auto|full|<lines 1-200>`, "error");
				return;
			}
			tailLines = n;
			rerenderTranscript(ctx);
			ctx.ui.notify(`tail-thinking: tail set to ${n} lines`);
		},
	});
}
