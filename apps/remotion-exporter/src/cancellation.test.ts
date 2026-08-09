import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import { installCancellationHandlers } from "./cancellation";

describe("render cancellation", () => {
	test("cancels once on either termination signal and removes both handlers", () => {
		const emitter = new EventEmitter();
		let cancellations = 0;
		const cleanup = installCancellationHandlers(() => cancellations++, emitter as never);
		emitter.emit("SIGINT");
		emitter.emit("SIGINT");
		expect(cancellations).toBe(1);
		cleanup();
		emitter.emit("SIGTERM");
		expect(cancellations).toBe(1);
		expect(emitter.listenerCount("SIGINT")).toBe(0);
		expect(emitter.listenerCount("SIGTERM")).toBe(0);
	});
});
