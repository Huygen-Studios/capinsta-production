"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CapinstaCaptionRenderer } from "@/capinsta/render/CapinstaCaptionRenderer";
import { createCapinstaRenderModelFromIndex } from "@/capinsta/render/capinstaRenderModel";
import {
	createCapinstaCaptionTimingIndex,
	getActiveCapinstaCaptionStateFromIndex,
} from "@/capinsta/captionTimingIndex";
import type {
	NeutralCaptionDocument,
	CapinstaCaptionDocumentRecord,
} from "@/capinsta/types";
import { computeCaptionStyleHash, summarizeCaptionStyle } from "@/capinsta/export/exportStyleHash";
import {
	resolveCapinstaCaptionLayout,
	summarizeCaptionLayout,
	computeCaptionLayoutHash,
} from "@/capinsta/export/captionLayoutDiagnostics";
import { resolveCapinstaClipStyle } from "@/capinsta/styles/styleMigration";
import {
	resolveRenderBackground,
	isCaptionsOnlyMode,
} from "./renderColor";

// ─── Global type declarations for the render page API ──────────────────────

declare global {
	interface Window {
		__RENDER_PAGE_LOADED__: boolean;
		__RENDER_PAGE_LAST_ERROR__: string;
		__OVERLAY_ONLY_MODE__: boolean;
		HUYGEN_RENDER_MODE: string;
		__EXPORT_OVERLAY_RECT__: { width: number; height: number } | null;
		__EXPORT_STYLE_HASH__: string | null;
		__EXPORT_STYLE_INFO__: Record<string, unknown> | null;
		__EXPORT_LAYOUT_INFO__: Record<string, unknown> | null;
		__EXPORT_LAYOUT_HASH__: string | null;
		__EXPORT_DEBUG_OVERLAYS_FOUND__: number | null;
		/** Resolved/applied background color (canonical #RRGGBB). */
		__EXPORT_APPLIED_BACKGROUND_COLOR__: string | null;
		/** Resolved render mode actually applied to the composition. */
		__EXPORT_APPLIED_RENDER_MODE__: string | null;
		/** Output dimensions applied to the composition root. */
		__EXPORT_OUTPUT_SIZE__: { width: number; height: number } | null;
		setCaptionData(
			captionsJson: string,
			theme: string,
			width: number,
			height: number,
			styleConfigJson: string,
			fps: number,
			backgroundColor: string,
			compositionJson: string,
			renderMode: string,
			jobId: string,
			duration: number,
			audioIncluded: boolean,
		): { ok: boolean; error?: string; detail?: string };
		setCaptionTime(timeSeconds: number): void;
		setCaptionFrame(frameIndex: number): void;
		isReady(): boolean;
		/**
		 * Explicitly signal that the composition is ready for capture: captions
		 * loaded, fonts ready, background + dimensions applied, and (for
		 * captions-only mode) a first caption frame committed. The backend
		 * waits on document.documentElement.dataset.renderReady === "true".
		 */
		markRenderReady(reason: string): void;
		/** Returns the readiness diagnostics object for backend introspection. */
		getRenderReadiness(): {
			ready: boolean;
			renderMode: string | null;
			backgroundColor: string | null;
			outputSize: { width: number; height: number } | null;
			fontsReady: boolean;
			captionsLoaded: boolean;
			overlayRootPresent: boolean;
			prohibitedUICount: number;
			firstFrameReady: boolean;
			reason: string;
		};
		/**
		 * Defensive cleanup: remove any consent/banner/fixed application UI that
		 * should never appear on the render route. Targets only known consent
		 * selectors and never touches caption elements. Returns the count removed.
		 */
		stripProhibitedRenderUI(): number;
		/**
		 * Assert the render route is clean before capture. Returns
		 * { ok, debugOverlaysFound, reason }. ok===false means prohibited
		 * application UI (cookie banner, toasts, fixed controls) is still
		 * present and capture must not proceed.
		 */
		assertExportClean(): {
			ok: boolean;
			debugOverlaysFound: number;
			reason?: string;
		};
	}
}

// Selectors for known application UI that must never appear on the render
// route. Kept narrow and explicit: consent widgets + toasts + fixed controls.
// Caption elements live under [data-capinsta-export-overlay-root] and are never
// matched by any of these selectors.
const PROHIBITED_UI_SELECTORS = [
	'[data-cookie-banner]',
	'[data-consent-root]',
	'.cookie-banner',
	'#cookie-consent',
	'[role="dialog"][aria-label="Cookie preferences"]',
	'[data-sonner-toaster]',
	'[data-radix-popper-content-wrapper]',
].join(",");


interface CaptionState {
	records: CapinstaCaptionDocumentRecord[];
	width: number;
	height: number;
	fps: number;
	theme: string;
	backgroundColor: string;
	renderMode: string;
	duration: number;
	jobId: string;
}

export function RenderPageClient() {
	const [captionState, setCaptionState] = useState<CaptionState | null>(null);
	const [timeSeconds, setTimeSeconds] = useState(0);
	const overlayRootRef = useRef<HTMLDivElement>(null);
	const stateRef = useRef<CaptionState | null>(null);
	const fpsRef = useRef(30);
	/**
	 * Tracks whether at least one caption frame has been committed for the
	 * current state. Required by getRenderReadiness()/markRenderReady() so the
	 * backend only begins capture after a real first frame is painted.
	 */
	const firstFrameReadyRef = useRef(false);

	const applyState = useCallback((state: CaptionState) => {
		stateRef.current = state;
		fpsRef.current = state.fps || 30;
		firstFrameReadyRef.current = false;
		setCaptionState(state);

		// Expose globals for post-inject validation
		if (typeof window !== "undefined") {
			window.__OVERLAY_ONLY_MODE__ = true;
			window.HUYGEN_RENDER_MODE = state.renderMode || "full_video";
			window.__EXPORT_DEBUG_OVERLAYS_FOUND__ = 0;
			window.__EXPORT_APPLIED_RENDER_MODE__ = state.renderMode || "full_video";
			window.__EXPORT_APPLIED_BACKGROUND_COLOR__ = state.backgroundColor;
			window.__EXPORT_OUTPUT_SIZE__ = { width: state.width, height: state.height };
		}
	}, []);

	/**
	 * Apply the requested background color to the FULL capture surface so that
	 * no white page background can leak into screenshots. Playwright's
	 * omit_background=True only strips the default canvas; explicitly CSS-painted
	 * white on <body> (globals.css --background) survives capture. We therefore
	 * paint html, body, and the render root with the resolved color in
	 * captions-only mode. For full-video mode the color is irrelevant (the
	 * source video fills the frame) so we leave the surface transparent.
	 */
	const applyRenderSurfaceStyles = useCallback(
		(renderMode: string, backgroundColor: string, width: number, height: number) => {
			if (typeof document === "undefined") return;
			const rootEl = document.documentElement;
			const bodyEl = document.body;
			if (!rootEl || !bodyEl) return;

			const captionsOnly = isCaptionsOnlyMode(renderMode);
			const surfaceColor = captionsOnly ? backgroundColor : "transparent";

			// html/body: zero box-model chrome, no scrollbars, exact output size.
			const baseCss: Partial<CSSStyleDeclaration> = {
				margin: "0",
				padding: "0",
				overflow: "hidden",
				background: surfaceColor,
			};
			Object.assign(rootEl.style, baseCss);
			// Body covers the full viewport at the output resolution.
			Object.assign(bodyEl.style, {
				...baseCss,
				width: `${width}px`,
				height: `${height}px`,
			});

			// Document-level marker so backend/external tooling can confirm this
			// is a headless render surface regardless of route.
			rootEl.dataset.headlessRender = "true";
		},
		[],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;

		// Mark page as loaded
		window.__RENDER_PAGE_LOADED__ = true;
		window.__RENDER_PAGE_LAST_ERROR__ = "";
		window.__OVERLAY_ONLY_MODE__ = true;
		window.HUYGEN_RENDER_MODE = "full_video";
		window.__EXPORT_OVERLAY_RECT__ = null;
		window.__EXPORT_STYLE_HASH__ = null;
		window.__EXPORT_STYLE_INFO__ = null;
		window.__EXPORT_LAYOUT_INFO__ = null;
		window.__EXPORT_LAYOUT_HASH__ = null;
		window.__EXPORT_DEBUG_OVERLAYS_FOUND__ = null;
		window.__EXPORT_APPLIED_BACKGROUND_COLOR__ = null;
		window.__EXPORT_APPLIED_RENDER_MODE__ = null;
		window.__EXPORT_OUTPUT_SIZE__ = null;

		window.isReady = () => window.__RENDER_PAGE_LOADED__ === true;

		/**
		 * stripProhibitedRenderUI — defensive cleanup of application UI that must
		 * never appear on the render route. Targets only known consent/toast/fixed
		 * controls via explicit selectors and never matches caption elements
		 * (which live under [data-capinsta-export-overlay-root]).
		 */
		window.stripProhibitedRenderUI = () => {
			if (typeof document === "undefined") return 0;
			let removed = 0;
			const nodes = document.querySelectorAll<HTMLElement>(PROHIBITED_UI_SELECTORS);
			nodes.forEach((node) => {
				// Never remove anything inside the caption composition root.
				if (node.closest('[data-capinsta-export-overlay-root="true"]')) return;
				try {
					node.remove();
					removed += 1;
				} catch {
					// non-fatal
				}
			});
			return removed;
		};

		/**
		 * assertExportClean — pre-capture assertion. ok===false means prohibited
		 * application UI is still mounted and capture must not proceed.
		 */
		window.assertExportClean = () => {
			if (typeof document === "undefined") return { ok: true, debugOverlaysFound: 0 };
			// First attempt a defensive strip so a banner that flashed is gone.
			window.stripProhibitedRenderUI();
			const found = document.querySelectorAll(PROHIBITED_UI_SELECTORS).length;
			// Also flag any position:fixed/sticky element that is NOT part of the
			// caption composition (e.g. floating dev widgets, chat, nav bars). The
			// composition root (#render-frame) carries data-capinsta-export-overlay-root,
			// so the closest() check excludes it and all caption children.
			const fixedOutside = Array.from(
				document.querySelectorAll<HTMLElement>('*[style*="fixed"], *[style*="sticky"]'),
			).filter(
				(el) => !el.closest('[data-capinsta-export-overlay-root="true"]'),
			).length;
			const total = found + fixedOutside;
			if (total > 0) {
				return {
					ok: false,
					debugOverlaysFound: total,
					reason: `prohibited application UI present on render route (${found} consent/toast, ${fixedOutside} fixed/sticky)`,
				};
			}
			return { ok: true, debugOverlaysFound: 0 };
		};

		/**
		 * getRenderReadiness — explicit readiness diagnostics. The backend waits
		 * on document.documentElement.dataset.renderReady === "true" (set by
		 * markRenderReady) instead of an arbitrary timeout.
		 */
		window.getRenderReadiness = () => {
			const state = stateRef.current;
			const fontsReady =
				typeof document !== "undefined" && "fonts" in document
					? (document as Document & { fonts: { ready: Promise<unknown> } }).fonts
							? true
							: false
					: true;
			return {
				ready: Boolean(
					state &&
						window.__RENDER_PAGE_LOADED__ &&
						window.__EXPORT_APPLIED_BACKGROUND_COLOR__ &&
						window.__EXPORT_OUTPUT_SIZE__ &&
						firstFrameReadyRef.current,
				),
				renderMode: window.__EXPORT_APPLIED_RENDER_MODE__,
				backgroundColor: window.__EXPORT_APPLIED_BACKGROUND_COLOR__,
				outputSize: window.__EXPORT_OUTPUT_SIZE__,
				fontsReady,
				captionsLoaded: Boolean(state),
				overlayRootPresent:
					typeof document !== "undefined" &&
					Boolean(document.querySelector('[data-capinsta-export-overlay-root="true"]')),
				prohibitedUICount: typeof document !== "undefined"
					? document.querySelectorAll(PROHIBITED_UI_SELECTORS).length
					: 0,
				firstFrameReady: firstFrameReadyRef.current,
				reason: state
					? firstFrameReadyRef.current
						? "ready"
						: "awaiting first caption frame"
					: "awaiting setCaptionData",
			};
		};

		/**
		 * markRenderReady — flip the explicit readiness flag the backend polls.
		 */
		window.markRenderReady = (reason: string) => {
			if (typeof document === "undefined") return;
			document.documentElement.dataset.renderReady = "true";
			document.documentElement.dataset.renderReadyReason = reason;
			window.__RENDER_PAGE_LAST_ERROR__ =
				window.__RENDER_PAGE_LAST_ERROR__ || "";
			// eslint-disable-next-line no-console
			console.info(`[render] renderReady: ${reason}`);
		};

		/**
		 * setCaptionData — called by the backend to inject caption data before
		 * frame capture begins.
		 */
		window.setCaptionData = (
			captionsJson,
			theme,
			width,
			height,
			_styleConfigJson,
			fps,
			backgroundColor,
			_compositionJson,
			renderMode,
			jobId,
			duration,
			_audioIncluded,
		) => {
			try {
				const captions = JSON.parse(captionsJson || "[]");
				if (!Array.isArray(captions)) {
					window.__RENDER_PAGE_LAST_ERROR__ = "captions must be an array";
					return { ok: false, error: "captions must be an array" };
				}

				// Resolve the canonical background color for this render mode.
				// captions-only -> selected hex (or green default when absent);
				// full-video -> transparent (source video fills the frame).
				const resolvedRenderMode = renderMode || "full_video";
				const resolvedBackground = resolveRenderBackground(
					resolvedRenderMode,
					backgroundColor,
				);

				// Visible diagnostic log exactly as required by the spec.
				const w = Number(width);
				const h = Number(height);
				// eslint-disable-next-line no-console
				console.info(`[render] renderMode: ${resolvedRenderMode}`);
				// eslint-disable-next-line no-console
				console.info(
					`[render] requested backgroundColor: ${backgroundColor || "(none)"}`,
				);
				// eslint-disable-next-line no-console
				console.info(
					`[render] applied composition backgroundColor: ${resolvedBackground}`,
				);
				// eslint-disable-next-line no-console
				console.info(`[render] output size: ${w}x${h}`);

				// Paint html/body/render-root with the resolved color so the
				// captured frame can never show the white page background.
				applyRenderSurfaceStyles(resolvedRenderMode, resolvedBackground, w, h);

				// Build a CapinstaCaptionDocumentRecord from the raw captions array.
				// The backend sends an array of clip objects with embedded words.
				const clips = captions.map((clip: any, i: number) => ({
					id: clip.id ?? `clip-${i}`,
					trackId: clip.trackId ?? "capinsta-export",
					start: Number(clip.start ?? 0),
					end: Number(clip.end ?? 0),
					text: clip.text ?? "",
					wordIds: (clip.words ?? []).map((w: any, wi: number) =>
						w.id ?? `word-${i}-${wi}`,
					),
					stylePresetId: clip.stylePresetId ?? theme ?? "word_highlight_box",
					selected: false,
					editable: false,
					manuallyEdited: false,
					timingNeedsReview: false,
					timingSource: "provider" as const,
					style: clip.style ?? undefined,
					sourceClipId: clip.id ?? `clip-${i}`,
				}));

				const words = captions.flatMap((clip: any, i: number) =>
					(clip.words ?? []).map((w: any, wi: number) => ({
						id: w.id ?? `word-${i}-${wi}`,
						text: w.text ?? w.word ?? "",
						displayedText: w.displayedWord ?? w.text ?? w.word ?? "",
						start: Number(w.start ?? 0),
						end: Number(w.end ?? 0),
						timingSource: "provider" as const,
						sourceWordId: w.id ?? `word-${i}-${wi}`,
					})),
				);

				const doc: NeutralCaptionDocument = {
					id: `export-doc-${jobId}`,
					trackId: "capinsta-export",
					sourceTranscriptRef: {
						version: "capinsta.transcript.v1",
						sourceAssetId: jobId,
						sourceAssetName: "export",
						provider: "export",
					},
					durationSeconds: duration,
					languageMode: "english",
					stylePresetId: theme ?? "word_highlight_box",
					clips,
					words,
					manualEdits: {},
					timing: {
						sourceOfTruth: "clips",
						generatedAt: new Date().toISOString(),
					},
				};

				const record: CapinstaCaptionDocumentRecord = {
					document: doc,
					openCutTrackId: "capinsta-export",
					importedAt: new Date().toISOString(),
				};

				applyState({
					records: [record],
					width: w,
					height: h,
					fps: Number(fps) || 30,
					theme: theme ?? "word_highlight_box",
					backgroundColor: resolvedBackground,
					renderMode: resolvedRenderMode,
					duration: Number(duration),
					jobId,
				});

				// Update overlay rect + signal first-frame readiness after React
				// commits the composition on the next paint. The readiness check
				// also requires fonts to be loaded; we resolve that here.
				requestAnimationFrame(() => {
					const settle = () => {
						if (overlayRootRef.current) {
							const rect = overlayRootRef.current.getBoundingClientRect();
							window.__EXPORT_OVERLAY_RECT__ = {
								width: rect.width,
								height: rect.height,
							};
							window.__EXPORT_LAYOUT_INFO__ = {
								canvasWidth: w,
								canvasHeight: h,
							};
						}
						// Re-assert the surface styles after React commit, in case the
						// framework re-rendered body children and reset inherited styles.
						applyRenderSurfaceStyles(resolvedRenderMode, resolvedBackground, w, h);
						// Defensive: strip any prohibited UI that mounted as part of the
						// normal app layout (cookie banner, toasts, fixed controls).
						window.stripProhibitedRenderUI?.();
						firstFrameReadyRef.current = true;
						const fontsObj = (document as Document & {
							fonts?: { ready?: Promise<unknown> };
						}).fonts;
						const fontsReady = fontsObj?.ready ?? Promise.resolve();
						void fontsReady.then(() => {
							window.markRenderReady?.("first-frame-committed");
						});
					};
					// Allow the React commit to flush before measuring.
					requestAnimationFrame(settle);
				});

				return { ok: true };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				window.__RENDER_PAGE_LAST_ERROR__ = msg;
				return { ok: false, error: "Failed to parse caption data", detail: msg };
			}
		};

		/** setCaptionTime — advance overlay to given time in seconds */
		window.setCaptionTime = (time: number) => {
			setTimeSeconds(time);
			return true;
		};

		/** setCaptionFrame — advance overlay by frame index */
		window.setCaptionFrame = (frame: number) => {
			const fps = fpsRef.current;
			setTimeSeconds(frame / Math.max(1, fps));
			return true;
		};
	}, [applyState]);

	// Update style/layout globals whenever active caption changes
	useEffect(() => {
		if (!captionState || typeof window === "undefined") return;
		const { records, width, height } = captionState;
		const index = createCapinstaCaptionTimingIndex({ records });
		const activeState = getActiveCapinstaCaptionStateFromIndex({ index, timeSeconds });
		if (!activeState) return;
		try {
			const style = resolveCapinstaClipStyle({
				document: activeState.document,
				clip: activeState.clip,
			});
			window.__EXPORT_STYLE_HASH__ = computeCaptionStyleHash(style);
			window.__EXPORT_STYLE_INFO__ = summarizeCaptionStyle(style);
			try {
				const resolved = resolveCapinstaCaptionLayout(style, width, height);
				window.__EXPORT_LAYOUT_INFO__ = {
					...summarizeCaptionLayout(resolved),
					canvasWidth: width,
					canvasHeight: height,
				};
				window.__EXPORT_LAYOUT_HASH__ = computeCaptionLayoutHash(resolved);
			} catch {
				// non-fatal
			}
		} catch {
			// non-fatal
		}
	}, [captionState, timeSeconds]);

		if (!captionState) {
			// Page loaded, awaiting setCaptionData injection.
			// Surface stays transparent until data arrives; html/body styles are
			// set imperatively in setCaptionData.
			return (
				<div
					id="render-frame"
					style={{ width: "100vw", height: "100vh", background: "transparent" }}
				/>
			);
		}

		const { records, width, height, backgroundColor } = captionState;
		const index = createCapinstaCaptionTimingIndex({ records });
		const activeState = getActiveCapinstaCaptionStateFromIndex({ index, timeSeconds });
		const viewport = { width, height };
		const renderModel = activeState
			? createCapinstaRenderModelFromIndex({
					index,
					timeSeconds,
					rendererPath: "rendered_capinsta_wysiwyg",
					viewport,
				})
			: null;

		return (
			<div
				id="render-frame"
				data-capinsta-export-overlay-root="true"
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					width,
					height,
					overflow: "hidden",
					// Use the resolved backgroundColor from state. For captions-only
					// this is the user-selected hex (or green default). For full-video
					// this is "transparent" (the source video fills the frame).
					background: backgroundColor,
					pointerEvents: "none",
				}}
				ref={overlayRootRef}
			>
				{activeState && renderModel && (
					<CapinstaCaptionRenderer
						renderModel={renderModel}
						activeWordIds={activeState.activeWordIds}
						timeSeconds={timeSeconds}
						isPlaying={false}
					viewport={viewport}
				/>
			)}
		</div>
	);
}
