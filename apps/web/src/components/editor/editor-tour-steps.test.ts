import { describe, expect, test } from "bun:test";
import {
	canLaunchEditorTour,
	createEditorTourSteps,
	filterAvailableEditorTourSteps,
	shouldAutoStartEditorTour,
} from "./editor-tour-steps";

describe("editor tour steps", () => {
	test("keeps first-run onboarding disabled after completion", () => {
		expect(
			shouldAutoStartEditorTour({
				isStorageReady: true,
				hasCompletedOnboarding: true,
			}),
		).toBe(false);
	});

	test("starts automatically only once storage is ready and incomplete", () => {
		expect(
			shouldAutoStartEditorTour({
				isStorageReady: false,
				hasCompletedOnboarding: false,
			}),
		).toBe(false);
		expect(
			shouldAutoStartEditorTour({
				isStorageReady: true,
				hasCompletedOnboarding: false,
			}),
		).toBe(true);
	});

	test("manual tour definitions include restart and workflow steps", () => {
		const steps = createEditorTourSteps();
		expect(steps.at(0)?.popover?.title).toBe("Welcome to Capinsta");
		expect(steps.some((step) => step.element === '[data-tour="guide-me"]')).toBe(
			true,
		);
		expect(
			steps.some((step) => step.element === '[data-tour="caption-tools"]'),
		).toBe(true);
		expect(
			steps.some((step) => step.element === '[data-tour="send-feedback"]'),
		).toBe(true);
		expect(
			steps.some(
				(step) => step.element === '[data-tour="project-info-settings"]',
			),
		).toBe(true);
		expect(
			steps.some(
				(step) => step.element === '[data-tour="background-settings"]',
			),
		).toBe(true);
	});

	test("manual restart is allowed even after first-run onboarding is complete", () => {
		expect(
			canLaunchEditorTour({
				source: "manual",
				isStorageReady: true,
				hasCompletedOnboarding: true,
			}),
		).toBe(true);
		expect(
			canLaunchEditorTour({
				source: "auto",
				isStorageReady: true,
				hasCompletedOnboarding: true,
			}),
		).toBe(false);
	});

	test("skips unavailable targets without dropping untargeted welcome step", () => {
		const steps = createEditorTourSteps();
		const available = filterAvailableEditorTourSteps({
			steps,
			isTargetAvailable: (selector) =>
				selector === '[data-tour="preview-panel"]' ||
				selector === '[data-tour="export"]',
		});

		expect(available.map((step) => step.popover?.title)).toEqual([
			"Welcome to Capinsta",
			"Preview your video",
			"Export your final video",
		]);
	});
});
