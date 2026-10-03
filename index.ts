// tail-thinking: keeps the chain of thought to a rolling tail in the transcript.
// While the model is streaming its thinking, only the last 15 lines are shown
// (with a "… +N lines" header); the moment thinking ends — answer text or a
// tool call starts, or the message finalizes — the block collapses to a single
// dim line with the line count. Historical messages render collapsed too.
//
// Built on registerMarkdownTransformer, so it composes with the built-in
// thinking controls: Ctrl+T (hide thinking) and click overrides replace the
// block entirely and bypass this transformer.
//
// /cot        — show current mode and tail size
// /cot auto   — tail while thinking, collapse after (default)
// /cot full   — never collapse, always show full thinking
// /cot <N>    — tail size in lines, e.g. /cot 25 (default 15)

const DEFAULT_TAIL_LINES = 15;

let tailLines = DEFAULT_TAIL_LINES;
let mode: "auto" | "full" = "auto";

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
		if (mode === "full") return markdown;

		const lines = markdown.split("\n");

		if (context.isStreaming && thinkingActive) {
			if (lines.length <= tailLines) return markdown;
			const hidden = lines.length - tailLines;
			return `… +${hidden} lines\n${lines.slice(-tailLines).join("\n")}`;
		}

		// Thinking finished (or historical render): collapse to one line.
		return `▸ thinking · ${lines.length} lines — collapsed`;
	});

	pi.registerCommand("cot", {
		description: "Chain-of-thought display: /cot [auto|full|<lines>]",
		handler: async (args: string, ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }) => {
			const arg = args.trim();
			if (!arg) {
				ctx.ui.notify(
					mode === "auto"
						? `tail-thinking: last ${tailLines} lines while thinking, collapsed after (/cot auto|full|<N>)`
						: `tail-thinking: full thinking shown (/cot auto to restore tail+collapse)`,
				);
				return;
			}
			if (arg === "auto" || arg === "full") {
				mode = arg;
				ctx.ui.notify(
					mode === "auto"
						? `tail-thinking: showing last ${tailLines} lines while thinking, collapsing after`
						: "tail-thinking: full thinking shown (no tail, no collapse)",
				);
				return;
			}
			const n = Number(arg);
			if (!Number.isInteger(n) || n < 1 || n > 200) {
				ctx.ui.notify(`tail-thinking: don't understand "${arg}" — use /cot auto|full|<lines 1-200>`, "error");
				return;
			}
			tailLines = n;
			ctx.ui.notify(`tail-thinking: tail set to ${n} lines (${mode} mode)`);
		},
	});
}
