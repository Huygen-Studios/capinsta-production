import type { DriveStep } from "driver.js";

export type EditorTourSource = "auto" | "manual";

const TARGET_SELECTORS = {
	assets: '[data-tour="assets-panel"]',
	preview: '[data-tour="preview-panel"]',
	timeline: '[data-tour="timeline"]',
	captions: '[data-tour="caption-tools"]',
	properties: '[data-tour="properties-panel"]',
	projectInfo: '[data-tour="project-info-settings"]',
	background: '[data-tour="background-settings"]',
	backgroundCustomization: '[data-tour="background-customization"]',
	export: '[data-tour="export"]',
	guideMe: '[data-tour="guide-me"]',
	sendFeedback: '[data-tour="send-feedback"]',
} as const;

export function createEditorTourSteps(): DriveStep[] {
	return [
		{
			popover: {
				title: "Welcome to Capinsta",
				description:
					"This quick guide shows you how to import media, create captions, edit your timeline, and export a finished video.",
			},
		},
		{
			element: TARGET_SELECTORS.assets,
			popover: {
				title: "Add your media",
				description:
					"Import video, audio, images, and other assets here. Drag items onto the timeline to begin building your edit.",
				side: "right",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.preview,
			popover: {
				title: "Preview your video",
				description:
					"Use this preview to review your composition, check caption placement, and play through the current edit.",
				side: "bottom",
				align: "center",
			},
		},
		{
			element: TARGET_SELECTORS.timeline,
			popover: {
				title: "Edit on the timeline",
				description:
					"Arrange clips, trim their duration, move items in time, and control exactly when captions appear.",
				side: "top",
				align: "center",
			},
		},
		{
			element: TARGET_SELECTORS.captions,
			popover: {
				title: "Create and refine captions",
				description:
					"Generate captions from your video, correct the text, adjust timing, and choose how captions should be displayed.",
				side: "right",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.properties,
			popover: {
				title: "Edit selected content",
				description:
					"Select a clip, caption, or visual element to adjust its text, timing, position, style, and other properties.",
				side: "left",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.projectInfo,
			popover: {
				title: "Project settings",
				description:
					"Use Project info to confirm the project name, frame rate, aspect ratio, and canvas size before you export.",
				side: "right",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.background,
			popover: {
				title: "Background settings",
				description:
					"Open Background to choose blur, solid colors, gradients, and visual presets for caption-only or styled exports.",
				side: "right",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.backgroundCustomization,
			popover: {
				title: "Customize the canvas",
				description:
					"These controls change the background treatment behind your edit while keeping the timeline and captions untouched.",
				side: "right",
				align: "start",
			},
		},
		{
			element: TARGET_SELECTORS.export,
			popover: {
				title: "Export your final video",
				description:
					"When your edit is ready, export the video and download subtitle files if needed.",
				side: "bottom",
				align: "end",
			},
		},
		{
			element: TARGET_SELECTORS.sendFeedback,
			popover: {
				title: "Send feedback",
				description:
					"Use this button to report a bug, suggest an improvement, ask a question, or share what is working well.",
				side: "bottom",
				align: "end",
			},
		},
		{
			element: TARGET_SELECTORS.guideMe,
			popover: {
				title: "Need help again?",
				description:
					"Use Guide me anytime to restart this walkthrough and review the editor workflow.",
				side: "bottom",
				align: "end",
			},
		},
	];
}

export function isTourTargetAvailable({
	selector,
	doc = document,
}: {
	selector: string;
	doc?: Document;
}) {
	const element = doc.querySelector(selector);
	if (!(element instanceof HTMLElement)) return false;

	const styles = window.getComputedStyle(element);
	const rect = element.getBoundingClientRect();
	return (
		styles.display !== "none" &&
		styles.visibility !== "hidden" &&
		rect.width > 0 &&
		rect.height > 0
	);
}

export function filterAvailableEditorTourSteps(
	params: {
		steps: DriveStep[];
		isTargetAvailable?: (selector: string) => boolean;
	},
): DriveStep[] {
	const {
		steps,
		isTargetAvailable = (selector: string) =>
			isTourTargetAvailable({ selector }),
	} = params;

	return steps.filter((step) => {
		if (!step.element || typeof step.element !== "string") {
			return true;
		}

		return isTargetAvailable(step.element);
	});
}

export function shouldAutoStartEditorTour({
	isStorageReady,
	hasCompletedOnboarding,
}: {
	isStorageReady: boolean;
	hasCompletedOnboarding: boolean;
}) {
	return isStorageReady && !hasCompletedOnboarding;
}

export function canLaunchEditorTour({
	source,
	isStorageReady,
	hasCompletedOnboarding,
}: {
	source: EditorTourSource;
	isStorageReady: boolean;
	hasCompletedOnboarding: boolean;
}) {
	if (source === "manual") return true;

	return shouldAutoStartEditorTour({
		isStorageReady,
		hasCompletedOnboarding,
	});
}
