export type SignalEmitter = Pick<NodeJS.Process, "once" | "removeListener">;

export function installCancellationHandlers(cancel: () => void, emitter: SignalEmitter = process) {
	const handler = () => cancel();
	emitter.once("SIGINT", handler);
	emitter.once("SIGTERM", handler);
	return () => {
		emitter.removeListener("SIGINT", handler);
		emitter.removeListener("SIGTERM", handler);
	};
}
