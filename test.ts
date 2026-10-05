/**
 * Smoke test: runs index.ts against a fake ExtensionAPI. No network, no real
 * model, no real pi. `bun test.ts`.
 */

const { default: activate } = await import("./index.ts");

// Minimal ambient globals so the strict zero-dependency typecheck passes.
declare const console: { log: (...args: any[]) => void };
declare const process: { exit: (code?: number) => never };

// --- fake pi -----------------------------------------------------------------

type Handler = (event: any, ctx?: any) => any;
const handlers: Record<string, Handler[]> = {};
let transformer: Handler | undefined;
const commands: Record<string, { handler: Handler }> = {};
const shortcuts: Record<string, { description?: string; handler: Handler }> = {};

const pi = {
	on(event: string, handler: Handler) {
		(handlers[event] ??= []).push(handler);
	},
	registerMarkdownTransformer(t: Handler) {
		transformer = t;
	},
	registerCommand(name: string, opts: { handler: Handler }) {
		commands[name] = opts;
	},
	registerShortcut(key: string, opts: { description?: string; handler: Handler }) {
		shortcuts[key] = opts;
	},
};

activate(pi);

const notifications: string[] = [];
let rerenders = 0;
const ctx = {
	ui: {
		notify: (m: string) => notifications.push(m),
		// pi re-renders assistant messages via setHiddenThinkingLabel; the
		// extension must call it on every state change so shown blocks follow.
		setHiddenThinkingLabel: () => {
			rerenders++;
		},
	},
} as any;

const fire = (event: string, payload: any) => (handlers[event] ?? []).forEach((h) => h(payload, ctx));
const thinking = (msg: any) => ({ messageType: "assistant-thinking", isStreaming: true, ...msg });

// --- asserts -----------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
	if (cond) {
		passed++;
	} else {
		failed++;
		console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// --- tests -------------------------------------------------------------------

check("registers transformer and command", !!transformer && !!commands["cot"]);

check("registers only the Ctrl+T shortcut", !!shortcuts["ctrl+t"] && !shortcuts["alt+o"]);

const twentyLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
const six = "a\nb\nc\nd\ne\nf";
const five = "a\nb\nc\nd\ne";
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: twentyLines }] } });
check("collapsed: streams tail", transformer!(twentyLines, thinking({})).split("\n").length === 16);

await commands["cot"].handler("full", ctx);
check("/cot full: full CoT passthrough", transformer!(twentyLines, thinking({})) === twentyLines);
await commands["cot"].handler("auto", ctx);
check("/cot auto collapses again: tail restored", transformer!(twentyLines, thinking({})).split("\n").length === 16);

let rerendersBefore = rerenders;
shortcuts["ctrl+t"].handler(ctx);
check("Ctrl+T hides: streaming thinking collapses to placeholder", transformer!(twentyLines, thinking({})) === "▸ thinking hidden (`ctrl+t` to expand)");
check("Ctrl+T hides: historical thinking collapses to placeholder", transformer!("a\nb\nc", { messageType: "assistant-thinking", isStreaming: false }) === "▸ thinking hidden (`ctrl+t` to expand)");
check("Ctrl+T re-renders the transcript", rerenders === rerendersBefore + 1);

// Hidden wins over expanded…
await commands["cot"].handler("full", ctx);
check("hidden wins over full mode", transformer!(twentyLines, thinking({})) === "▸ thinking hidden (`ctrl+t` to expand)");
shortcuts["ctrl+t"].handler(ctx);
check("showing while expanded reveals full CoT", transformer!(twentyLines, thinking({})) === twentyLines);
// …and back to the tail.
await commands["cot"].handler("auto", ctx);
check("/cot auto after show restores tail", transformer!(twentyLines, thinking({})).split("\n").length === 16);

rerendersBefore = rerenders;
await commands["cot"].handler("hide", ctx);
check("/cot hide hides", transformer!(twentyLines, thinking({})) === "▸ thinking hidden (`ctrl+t` to expand)");
await commands["cot"].handler("show", ctx);
check("/cot show reveals", transformer!(six, { messageType: "assistant-thinking", isStreaming: false }) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");
check("/cot show re-renders the transcript", rerenders === rerendersBefore + 2);

const twenty = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: twenty }] } });
const tail = transformer!(twenty, thinking({})).split("\n");
check("streams tail once thinking exceeds 15 lines", tail.length === 16 && tail[0] === "… +5 lines" && tail[1] === "line 6" && tail[15] === "line 20", JSON.stringify(tail));

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a\nb" }] } });
check("passes short thinking through while streaming", transformer!("a\nb", thinking({})) === "a\nb");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: six }, { type: "text", text: "Answer start" }] } });
check("collapses when answer text starts streaming", transformer!(six, thinking({})) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: six }, { type: "toolCall", id: "t1" }] } });
check("collapses when a tool call starts streaming", transformer!(six, thinking({})) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "text", text: "" }] } });
check("empty text block does not end thinking yet", transformer!("a", thinking({})) === "a");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: six }] } });
fire("message_end", { message: { role: "assistant" } });
check("collapses on message_end even while isStreaming flag lingers", transformer!(six, thinking({})) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

check("short historical blocks stay visible", transformer!(five, { messageType: "assistant-thinking", isStreaming: false }) === five);
check("historical renders (isStreaming=false) are collapsed", transformer!(six, { messageType: "assistant-thinking", isStreaming: false }) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

await commands["cot"].handler("full", ctx);
check("full mode is passthrough", transformer!(six, thinking({})) === six);
await commands["cot"].handler("auto", ctx);
check("/cot auto restores tail+collapse", transformer!(six, thinking({})) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

const eight = Array.from({ length: 8 }, (_, i) => `l${i}`).join("\n");
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: eight }] } });
rerendersBefore = rerenders;
await commands["cot"].handler("5", ctx);
check("/cot 5 changes tail size", transformer!(eight, thinking({})) === "… +3 lines\nl3\nl4\nl5\nl6\nl7");
check("/cot 5 notifies", notifications.some((n) => n.includes("tail set to 5")));
check("/cot 5 re-renders the transcript", rerenders === rerendersBefore + 1);
await commands["cot"].handler("auto", ctx);

check("user markdown untouched", transformer!("# hi", { messageType: "user", isStreaming: false }) === "# hi");
check("assistant markdown untouched", transformer!("# hi", { messageType: "assistant", isStreaming: false }) === "# hi");

// Establish a collapsed state (answer text streaming)…
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: six }, { type: "text", text: "hi" }] } });
check("collapsed state established", transformer!(six, { messageType: "assistant-thinking", isStreaming: true }) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");
// …a user-role update must not reactivate the tail, even with a lingering streaming flag.
fire("message_update", { message: { role: "user", content: [{ type: "text", text: "q" }] } });
check("user message_update does not flip state", transformer!(six, { messageType: "assistant-thinking", isStreaming: true }) === "▸ thinking · 6 lines — collapsed (`ctrl+t` to collapse)");

// -----------------------------------------------------------------------------

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
