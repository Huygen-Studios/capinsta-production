"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDeepCompareEffect from "use-deep-compare-effect";
import { useEditor } from "@/editor/use-editor";
import { useRafLoop } from "@/hooks/use-raf-loop";
import { useContainerSize } from "@/hooks/use-container-size";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { TICKS_PER_SECOND } from "@/wasm";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { buildScene } from "@/services/renderer/scene-builder";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "@/preview/overlays";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";
import {
	PreviewViewportProvider,
	usePreviewViewportState,
} from "./preview-viewport";
import { buildCapinstaPreviewTracks } from "@/capinsta/captionTimelineSync";
import { CapinstaActiveCaptionOverlay } from "./capinsta-active-caption-overlay";
import {
	usePreviewStore,
	PREVIEW_QUALITY_SCALE,
	computePreviewDimensions,
} from "@/preview/preview-store";
import { useAutoPreviewQuality } from "@/preview/hooks/use-auto-preview-quality";
import { EditorHelpButton } from "@/components/editor/editor-help-button";
import { EDITOR_HELP_CONTENT } from "@/components/editor/editor-help-content";

function usePreviewSize() {
	const canvasSize = useEditor(
		(e) => e.project.getActive()?.settings.canvasSize,
	);

	return {
		width: canvasSize?.width,
		height: canvasSize?.height,
	};
}

function normalizeWheelDelta({
	delta,
	deltaMode,
	pageSize,
}: {
	delta: number;
	deltaMode: number;
	pageSize: number;
}): number {
	if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return delta * 16;
	}

	if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return delta * pageSize;
	}

	return delta;
}

export function PreviewPanel({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const { toggleFullscreen } = useFullscreen({ containerRef });
	const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		setContainer(node);
	}, []);

	return (
		<div
			ref={handleContainerRef}
			className="panel editor-panel relative flex size-full min-h-0 min-w-0 flex-col"
			data-tour="preview-panel"
		>
			<div className="absolute right-2 top-2 z-20">
				<EditorHelpButton
					title={EDITOR_HELP_CONTENT.preview.title}
					description={EDITOR_HELP_CONTENT.preview.description}
				/>
			</div>
			<PreviewCanvas
				container={container}
				onToggleFullscreen={toggleFullscreen}
				overlayControls={overlayControls}
				overlayInstances={overlayInstances}
				onOverlayVisibilityChange={onOverlayVisibilityChange}
			/>
			<RenderTreeController />
		</div>
	);
}

function RenderTreeController() {
	const editor = useEditor();
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const activeProject = useEditor((e) => e.project.getActive());
	const capinstaCaptionDocuments =
		activeProject?.capinstaCaptionDocuments ?? [];

	const { width, height } = usePreviewSize();

	useDeepCompareEffect(() => {
		if (!activeProject) return;

		const duration = editor.timeline.getTotalDuration();
		const previewTracks = buildCapinstaPreviewTracks({
			records: capinstaCaptionDocuments,
			tracks,
		});
		const renderTree = buildScene({
			tracks: previewTracks,
			mediaAssets,
			duration,
			canvasSize: { width, height },
			background: activeProject.settings.background,
			isPreview: true,
			capinstaCaptionDocuments,
		});

		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true") {
			console.debug("[preview] Scene rebuilt", {
				canvasSize: { width, height },
				duration,
				mainTrack: {
					id: tracks.main.id,
					hidden: tracks.main.hidden,
					elements: tracks.main.elements.map((element) => ({
						id: element.id,
						type: element.type,
						mediaId: element.mediaId,
						hidden: element.hidden,
						startTime: element.startTime,
						duration: element.duration,
						params: element.params,
					})),
				},
				overlayTrackCount: tracks.overlay.length,
				audioTrackCount: tracks.audio.length,
				mediaAssets: mediaAssets.map((asset) => ({
					id: asset.id,
					type: asset.type,
					name: asset.name,
					hasFile: Boolean(asset.file),
					fileType: asset.file?.type,
					fileSize: asset.file?.size,
					hasUrl: Boolean(asset.url),
					width: asset.width,
					height: asset.height,
					duration: asset.duration,
				})),
				renderNodeTypes: renderTree.children.map(
					(node) => node.constructor.name,
				),
			});
		}

		editor.renderer.setRenderTree({ renderTree });
	}, [
		tracks,
		mediaAssets,
		activeProject?.settings.background,
		capinstaCaptionDocuments,
		width,
		height,
	]);

	return null;
}

function PreviewCanvas({
	container,
	onToggleFullscreen,
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	container: HTMLElement | null;
	onToggleFullscreen: () => void;
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const canvasMountRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastSceneRef = useRef<RootNode | null>(null);
	const renderingRef = useRef(false);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const renderTree = useEditor((e) => e.renderer.getRenderTree());
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	// Preview quality: read the resolved quality and compute scaled dimensions.
	// The visible size stays the same — only the internal render resolution changes.
	const resolvedQuality = usePreviewStore((s) => s.resolvedQuality);
	const previewScale = PREVIEW_QUALITY_SCALE[resolvedQuality];
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());
	const { recordFrameRender } = useAutoPreviewQuality({ isPlaying });

	const { width: previewWidth, height: previewHeight } =
		computePreviewDimensions({
			projectWidth: nativeWidth,
			projectHeight: nativeHeight,
			scale: previewScale,
		});

	// Debug logging for preview quality
	useEffect(() => {
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true") return;
		console.debug("[preview-quality] dimensions computed", {
			projectResolution: { width: nativeWidth, height: nativeHeight },
			internalRenderResolution: { width: previewWidth, height: previewHeight },
			previewQualityScale: previewScale,
			resolvedQuality,
			visibleSceneSize: {
				width: viewport.sceneWidth,
				height: viewport.sceneHeight,
			},
		});
	}, [
		nativeWidth,
		nativeHeight,
		previewWidth,
		previewHeight,
		previewScale,
		resolvedQuality,
		viewport.sceneWidth,
		viewport.sceneHeight,
	]);

	const renderer = useMemo(() => {
		return new CanvasRenderer({
			width: previewWidth,
			height: previewHeight,
			fps: activeProject.settings.fps,
			renderScale: previewScale,
		});
	}, [previewWidth, previewHeight, previewScale, activeProject.settings.fps]);

	// Mount the compositor's output canvas directly into the preview.
	// CSS upscales the lower-resolution canvas to fill the same visible area.
	useEffect(() => {
		const mount = canvasMountRef.current;
		if (!mount) return;
		const outputCanvas = renderer.getOutputCanvas();
		outputCanvas.style.display = "block";
		outputCanvas.style.imageRendering = "auto";
		outputCanvas.style.width = "100%";
		outputCanvas.style.height = "100%";
		mount.appendChild(outputCanvas);
		return () => {
			if (outputCanvas.parentElement === mount) {
				mount.removeChild(outputCanvas);
			}
		};
	}, [renderer, previewScale]);

	const render = useCallback(() => {
		if (!renderTree || renderingRef.current) return;

		const renderTime = Math.min(
			editor.playback.getCurrentTime(),
			editor.timeline.getLastFrameTime(),
		);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * renderer.fps.denominator) / renderer.fps.numerator,
		);
		const frame = Math.floor(renderTime / ticksPerFrame);

		if (frame === lastFrameRef.current && renderTree === lastSceneRef.current) {
			return;
		}

		const sceneChanged = renderTree !== lastSceneRef.current;
		renderingRef.current = true;
		lastSceneRef.current = renderTree;
		const renderStart = performance.now();
		renderer
			.render({ node: renderTree, time: renderTime })
			.then(async () => {
				if (sceneChanged) {
					await kickWebGpuPresentation();
				}
				lastFrameRef.current = frame;
				recordFrameRender(performance.now() - renderStart);
			})
			.catch((error) => {
				lastFrameRef.current = -1;
				lastSceneRef.current = null;
				if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true") {
					console.warn("[preview] Failed to render frame; will retry", {
						frame,
						renderTime,
						error,
					});
				}
			})
			.finally(() => {
				renderingRef.current = false;
			});
	}, [
		renderer,
		renderTree,
		editor.playback,
		editor.timeline,
		recordFrameRender,
	]);

	useRafLoop(render);

	useEffect(() => {
		const container = viewportRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingPanDeltaX = 0;
		let pendingPanDeltaY = 0;
		let zoomRafId: ReturnType<typeof requestAnimationFrame> | null = null;
		let panRafId: ReturnType<typeof requestAnimationFrame> | null = null;

		const onWheel = (event: WheelEvent) => {
			const normalizedDeltaX = normalizeWheelDelta({
				delta: event.deltaX,
				deltaMode: event.deltaMode,
				pageSize: container.clientWidth,
			});
			const normalizedDeltaY = normalizeWheelDelta({
				delta: event.deltaY,
				deltaMode: event.deltaMode,
				pageSize: container.clientHeight,
			});
			const isZoomGesture = event.ctrlKey || event.metaKey;
			if (isZoomGesture) {
				event.preventDefault();
				pendingZoomDelta += normalizedDeltaY;

				if (zoomRafId === null) {
					zoomRafId = requestAnimationFrame(() => {
						const cappedDelta =
							Math.sign(pendingZoomDelta) *
							Math.min(Math.abs(pendingZoomDelta), 30);
						const zoomFactor = Math.exp(-cappedDelta / 300);

						scaleZoom({ factor: zoomFactor });
						pendingZoomDelta = 0;
						zoomRafId = null;
					});
				}

				return;
			}

			if (!canPan) {
				return;
			}

			if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
				return;
			}

			event.preventDefault();
			pendingPanDeltaX += normalizedDeltaX;
			pendingPanDeltaY += normalizedDeltaY;

			if (panRafId === null) {
				panRafId = requestAnimationFrame(() => {
					panByScreenDelta({
						deltaX: pendingPanDeltaX,
						deltaY: pendingPanDeltaY,
					});
					pendingPanDeltaX = 0;
					pendingPanDeltaY = 0;
					panRafId = null;
				});
			}
		};

		container.addEventListener("wheel", onWheel, {
			capture: true,
			passive: false,
		});

		return () => {
			container.removeEventListener("wheel", onWheel, {
				capture: true,
			});
			if (zoomRafId !== null) {
				cancelAnimationFrame(zoomRafId);
			}
			if (panRafId !== null) {
				cancelAnimationFrame(panRafId);
			}
		};
	}, [canPan, panByScreenDelta, scaleZoom]);

	return (
		<PreviewViewportProvider value={viewport}>
			<div className="flex size-full min-h-0 min-w-0 flex-col">
				<div className="flex min-h-0 min-w-0 flex-1 bg-background p-1 pb-0">
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								ref={viewportRef}
								className="relative flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden"
							>
								<div
									ref={canvasMountRef}
									className="absolute block border border-border bg-card"
									style={{
										left: viewport.sceneLeft,
										top: viewport.sceneTop,
										width: viewport.sceneWidth,
										height: viewport.sceneHeight,
										background:
											activeProject.settings.background.type === "blur"
												? "transparent"
												: activeProject?.settings.background.color,
									}}
								/>
								<CapinstaActiveCaptionOverlay
									sceneLeft={viewport.sceneLeft}
									sceneTop={viewport.sceneTop}
									sceneWidth={viewport.sceneWidth}
									sceneHeight={viewport.sceneHeight}
									canvasWidth={nativeWidth}
									canvasHeight={nativeHeight}
								/>
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="under-interaction"
								/>
								<PreviewInteractionOverlay />
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="over-interaction"
								/>
							</div>
						</ContextMenuTrigger>
						<PreviewContextMenu
							onToggleFullscreen={onToggleFullscreen}
							container={container}
							overlayControls={overlayControls}
							onOverlayVisibilityChange={onOverlayVisibilityChange}
						/>
					</ContextMenu>
				</div>
				<PreviewToolbar onToggleFullscreen={onToggleFullscreen} />
			</div>
		</PreviewViewportProvider>
	);
}

let previewPresentationKick: ReturnType<
	typeof createPreviewPresentationKick
> | null = null;

async function kickWebGpuPresentation(): Promise<void> {
	if (!navigator.gpu) return;

	previewPresentationKick ??= createPreviewPresentationKick();

	const presentationKick = await previewPresentationKick;
	if (!presentationKick) return;

	const encoder = presentationKick.device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: presentationKick.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				loadOp: "clear",
				storeOp: "store",
			},
		],
	});
	pass.end();
	presentationKick.device.queue.submit([encoder.finish()]);
	await presentationKick.device.queue.onSubmittedWorkDone();
}

async function createPreviewPresentationKick() {
	if (!navigator.gpu) return null;

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) return null;

	const device = await adapter.requestDevice();
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("webgpu");
	if (!context) return null;

	context.configure({
		device,
		format: navigator.gpu.getPreferredCanvasFormat(),
		alphaMode: "opaque",
	});
	return { device, context };
}
