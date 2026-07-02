import { createCanvas, type Canvas } from "@napi-rs/canvas";

type NodeCanvas = Canvas;

class NodeOffscreenCanvas {
	readonly #canvas: NodeCanvas;
	width: number;
	height: number;

	constructor(...[width, height]: [number, number]) {
		this.width = width;
		this.height = height;
		this.#canvas = createCanvas(width, height);
	}

	getContext(contextId: "2d") {
		if (contextId !== "2d") return null;
		return this.#canvas.getContext("2d");
	}
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
	Object.defineProperty(globalThis, "OffscreenCanvas", {
		configurable: true,
		writable: true,
		value: NodeOffscreenCanvas,
	});
}
