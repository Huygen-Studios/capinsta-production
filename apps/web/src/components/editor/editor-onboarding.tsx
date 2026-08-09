"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./editor-tour-theme.css";
import { useLocalStorage } from "@/services/storage/use-local-storage";
import { EDITOR_ONBOARDING_STORAGE_KEY } from "./editor-help-content";
import {
	createEditorTourSteps,
	canLaunchEditorTour,
	filterAvailableEditorTourSteps,
	shouldAutoStartEditorTour,
	type EditorTourSource,
} from "./editor-tour-steps";

type StartEditorTourOptions = {
	source?: EditorTourSource;
};

type EditorGuideContextValue = {
	startEditorTour: (options?: StartEditorTourOptions) => void;
};

const EditorGuideContext = createContext<EditorGuideContextValue | null>(null);

const TOUR_START_DELAY_MS = 650;

function hasStoredEditorOnboardingCompletion() {
	try {
		return (
			window.localStorage.getItem(EDITOR_ONBOARDING_STORAGE_KEY) === "true"
		);
	} catch {
		return false;
	}
}

export function EditorOnboardingProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [hasCompletedOnboarding, setHasCompletedOnboarding, isStorageReady] =
		useLocalStorage<boolean>({
			key: EDITOR_ONBOARDING_STORAGE_KEY,
			defaultValue: false,
		});
	const driverRef = useRef<Driver | null>(null);
	const autoStartTimerRef = useRef<number | null>(null);
	const steps = useMemo(() => createEditorTourSteps(), []);

	const markCompleted = useCallback(() => {
		setHasCompletedOnboarding({ value: true });
	}, [setHasCompletedOnboarding]);

	const startEditorTour = useCallback(
		({ source = "manual" }: StartEditorTourOptions = {}) => {
			if (typeof window === "undefined") return;
			if (source === "auto" && hasStoredEditorOnboardingCompletion()) {
				return;
			}
			if (
				!canLaunchEditorTour({
					source,
					isStorageReady,
					hasCompletedOnboarding,
				})
			) {
				return;
			}

			driverRef.current?.destroy();

			const availableSteps = filterAvailableEditorTourSteps({ steps });
			if (availableSteps.length === 0) return;

			const tour = driver({
				animate: true,
				allowClose: true,
				showProgress: true,
				smoothScroll: false,
				overlayOpacity: 0.6,
				stagePadding: 8,
				stageRadius: 6,
				popoverClass: "editor-tour-popover",
				disableActiveInteraction: false,
				nextBtnText: "Next",
				prevBtnText: "Back",
				doneBtnText: "Start editing",
				steps: availableSteps,
				onDestroyed: () => {
					driverRef.current = null;
					if (source === "auto" || !hasCompletedOnboarding) {
						markCompleted();
					}
				},
			});

			driverRef.current = tour;
			tour.drive();
		},
		[hasCompletedOnboarding, isStorageReady, markCompleted, steps],
	);

	useEffect(() => {
		if (
			!shouldAutoStartEditorTour({
				isStorageReady,
				hasCompletedOnboarding,
			})
		) {
			return;
		}

		autoStartTimerRef.current = window.setTimeout(() => {
			startEditorTour({ source: "auto" });
		}, TOUR_START_DELAY_MS);

		return () => {
			if (autoStartTimerRef.current !== null) {
				window.clearTimeout(autoStartTimerRef.current);
				autoStartTimerRef.current = null;
			}
		};
	}, [hasCompletedOnboarding, isStorageReady, startEditorTour]);

	useEffect(() => {
		return () => {
			if (autoStartTimerRef.current !== null) {
				window.clearTimeout(autoStartTimerRef.current);
			}
			driverRef.current?.destroy();
			driverRef.current = null;
		};
	}, []);

	const contextValue = useMemo(
		() => ({ startEditorTour }),
		[startEditorTour],
	);

	return (
		<EditorGuideContext.Provider value={contextValue}>
			{children}
		</EditorGuideContext.Provider>
	);
}

export function useEditorGuide() {
	const context = useContext(EditorGuideContext);
	if (!context) {
		return {
			startEditorTour: () => undefined,
		};
	}

	return context;
}
