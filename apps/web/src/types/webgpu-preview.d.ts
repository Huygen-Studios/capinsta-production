interface PreviewGpu {
	requestAdapter(): Promise<PreviewGpuAdapter | null>;
	getPreferredCanvasFormat(): string;
}

interface PreviewGpuAdapter {
	requestDevice(): Promise<PreviewGpuDevice>;
}

interface PreviewGpuDevice {
	createCommandEncoder(): PreviewGpuCommandEncoder;
	queue: {
		submit(commandBuffers: Iterable<unknown>): void;
		onSubmittedWorkDone(): Promise<void>;
	};
}

interface PreviewGpuCommandEncoder {
	beginRenderPass(descriptor: unknown): {
		end(): void;
	};
	finish(): unknown;
}

interface PreviewGpuCanvasContext {
	configure(configuration: {
		device: PreviewGpuDevice;
		format: string;
		alphaMode?: "opaque" | "premultiplied";
	}): void;
	getCurrentTexture(): {
		createView(): unknown;
	};
}

interface Navigator {
	readonly gpu?: PreviewGpu;
}

interface HTMLCanvasElement {
	getContext(
		contextId: "webgpu",
		options?: unknown,
	): PreviewGpuCanvasContext | null;
}
