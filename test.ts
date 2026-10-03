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
};

activate(pi);

const notifications: string[] = [];
const ctx = { ui: { notify: (m: string) => notifications.push(m) } } as any;

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

const twenty = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: twenty }] } });
const tail = transformer!(twenty, thinking({})).split("\n");
check("streams tail once thinking exceeds 15 lines", tail.length === 16 && tail[0] === "… +5 lines" && tail[1] === "line 6" && tail[15] === "line 20", JSON.stringify(tail));

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a\nb" }] } });
check("passes short thinking through while streaming", transformer!("a\nb", thinking({})) === "a\nb");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a\nb\nc" }, { type: "text", text: "Answer start" }] } });
check("collapses when answer text starts streaming", transformer!("a\nb\nc", thinking({})) === "▸ thinking · 3 lines — collapsed");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "toolCall", id: "t1" }] } });
check("collapses when a tool call starts streaming", transformer!("a", thinking({})) === "▸ thinking · 1 lines — collapsed");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "text", text: "" }] } });
check("empty text block does not end thinking yet", transformer!("a", thinking({})) === "a");

fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a\nb" }] } });
fire("message_end", { message: { role: "assistant" } });
check("collapses on message_end even while isStreaming flag lingers", transformer!("a\nb", thinking({})) === "▸ thinking · 2 lines — collapsed");

check("historical renders (isStreaming=false) are collapsed", transformer!("a\nb\nc", { messageType: "assistant-thinking", isStreaming: false }) === "▸ thinking · 3 lines — collapsed");

await commands["cot"].handler("full", ctx);
check("full mode is passthrough", transformer!("a\nb", thinking({})) === "a\nb");
await commands["cot"].handler("auto", ctx);
check("/cot auto restores tail+collapse", transformer!("a\nb", thinking({})) === "▸ thinking · 2 lines — collapsed");

const eight = Array.from({ length: 8 }, (_, i) => `l${i}`).join("\n");
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: eight }] } });
await commands["cot"].handler("5", ctx);
check("/cot 5 changes tail size", transformer!(eight, thinking({})) === "… +3 lines\nl3\nl4\nl5\nl6\nl7");
check("/cot 5 notifies", notifications.some((n) => n.includes("tail set to 5")));
await commands["cot"].handler("auto", ctx);

check("user markdown untouched", transformer!("# hi", { messageType: "user", isStreaming: false }) === "# hi");
check("assistant markdown untouched", transformer!("# hi", { messageType: "assistant", isStreaming: false }) === "# hi");

// Establish a collapsed state (answer text streaming)…
fire("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "text", text: "hi" }] } });
check("collapsed state established", transformer!("a", { messageType: "assistant-thinking", isStreaming: true }) === "▸ thinking · 1 lines — collapsed");
// …a user-role update must not reactivate the tail, even with a lingering streaming flag.
fire("message_update", { message: { role: "user", content: [{ type: "text", text: "q" }] } });
check("user message_update does not flip state", transformer!("a", { messageType: "assistant-thinking", isStreaming: true }) === "▸ thinking · 1 lines — collapsed");

// -----------------------------------------------------------------------------

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
