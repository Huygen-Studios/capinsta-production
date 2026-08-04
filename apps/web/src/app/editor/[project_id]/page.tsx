"use client";

import { useParams, useSearchParams } from "next/navigation";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import { EditorHeader } from "@/components/editor/editor-header";
import { EditorProvider } from "@/components/providers/editor-provider";
import { EditorOnboardingProvider } from "@/components/editor/editor-onboarding";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { usePanelStore } from "@/editor/panel-store";
import { usePasteMedia } from "@/media/use-paste-media";
import { MobileGate } from "@/components/editor/mobile-gate";
import { useMemo, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useProjectHeartbeat } from "@/capinsta/useProjectHeartbeat";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import {
	createPreviewOverlayControl,
	isPreviewOverlayVisible,
	mergePreviewOverlaySources,
} from "@/preview/overlays";
import { usePreviewStore } from "@/preview/preview-store";
import { getGuidePreviewOverlaySource } from "@/guides";
import {
	bookmarkNotesPreviewOverlay,
	getBookmarkPreviewOverlaySource,
} from "@/timeline/bookmarks/index";
import { EditorAdRail, EditorTopAd } from "@/components/adsense/editor-ads";
import {
	ClipBatchInspector,
	ClipBatchProvider,
	ClipSourceOverview,
	ClipTimelineContextBar,
} from "./clip-batch-workspace";

export default function Editor() {
	const params = useParams<{ project_id: string }>();
	const projectId = params.project_id;

	return (
		<MobileGate>
			<EditorProvider projectId={projectId}>
				<EditorOnboardingProvider>
					<ClipBatchProvider>
						<EditorProjectSession />
					</ClipBatchProvider>
				</EditorOnboardingProvider>
			</EditorProvider>
		</MobileGate>
	);
}

function EditorProjectSession() {
	const { isExpired } = useProjectHeartbeat();
	if (isExpired) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center p-6">
				<div className="max-w-md text-center">
					<h1 className="text-xl font-semibold">Project expired</h1>
					<p className="mt-3 text-sm text-muted-foreground">
						This project expired after 15 minutes of inactivity. Please start a
						new project.
					</p>
					<Button asChild className="mt-6">
						<Link href="/projects">Start a new project</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div
			className="editor-shell bg-background flex h-screen w-screen flex-col overflow-hidden"
			data-testid="editor-ready"
			data-tour="editor-root"
		>
			<DegradedRendererBanner />
			<EditorTopAd />
			<EditorHeader />
			<div className="editor-workspace-with-ads min-h-0 min-w-0 flex-1">
				<div className="min-h-0 min-w-0">
					<EditorLayout />
				</div>
				<EditorAdRail />
			</div>
			<MigrationDialog />
			<ChangelogNotification />
		</div>
	);
}

function DegradedRendererBanner() {
	const isDegraded = useEditor((e) => e.renderer.isDegraded);
	const [dismissed, setDismissed] = useState(false);
	if (!isDegraded || dismissed) return null;

	return (
		<div className="bg-accent border-b h-9 flex items-center justify-center gap-2 text-xs text-muted-foreground">
			<span>For the best experience, open Capinsta Editor in Chrome.</span>
			<Button
				variant="text"
				size="icon"
				className="p-0 w-auto [&_svg]:size-3.5"
				onClick={() => setDismissed(true)}
				aria-label="Dismiss"
			>
				<HugeiconsIcon icon={Cancel01Icon} />
			</Button>
		</div>
	);
}

function EditorLayout() {
	usePasteMedia();
	const isClippingMode = useSearchParams().get("mode") === "clipping";
	const { panels, setPanel } = usePanelStore();
	const activeScene = useEditor((editor) =>
		editor.scenes.getActiveSceneOrNull(),
	);
	const currentTime = useEditor((editor) => editor.playback.getCurrentTime());
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore(
		(state) => state.setOverlayVisibility,
	);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});

	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({
						guideId: activeGuide,
					}),
					activeScene
						? getBookmarkPreviewOverlaySource({
								bookmarks: activeScene.bookmarks,
								time: currentTime,
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		[activeGuide, activeScene, currentTime, showBookmarkNotes],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	return (
		<ResizablePanelGroup
			direction="vertical"
			className="size-full"
			onLayout={(sizes) => {
				setPanel({
					panel: "mainContent",
					size: sizes[0] ?? panels.mainContent,
				});
				setPanel({
					panel: "timeline",
					size: sizes[1] ?? panels.timeline,
				});
			}}
		>
			<ResizablePanel
				defaultSize={panels.mainContent}
				minSize={30}
				maxSize={85}
				className="min-h-0"
			>
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full px-1.5"
					onLayout={(sizes) => {
						setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
						setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
						setPanel({
							panel: "properties",
							size: sizes[2] ?? panels.properties,
						});
					}}
				>
					<ResizablePanel
						defaultSize={panels.tools}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<AssetsPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.preview}
						minSize={30}
						className="min-h-0 min-w-0 flex-1"
					>
						<PreviewPanel
							overlayControls={overlayControls}
							overlayInstances={overlaySource.instances}
							onOverlayVisibilityChange={setOverlayVisibility}
						/>
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.properties}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						{isClippingMode ? <ClipBatchInspector /> : <PropertiesPanel />}
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel
				defaultSize={panels.timeline}
				minSize={15}
				maxSize={70}
				className="min-h-0 px-1.5 pb-1.5 pt-1"
			>
				<div className="flex size-full min-h-0 flex-col">
					{isClippingMode ? <ClipSourceOverview /> : null}
					{isClippingMode ? <ClipTimelineContextBar /> : null}
					<div className="min-h-0 flex-1">
						<Timeline />
					</div>
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
