"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { storageService } from "@/services/storage/service";
import { getCapinstaApiBaseUrl } from "./featureFlags";
import { findExpiredLocalProjectIds } from "./expiredProjectReconciliation";

const RECONCILE_INTERVAL_MS = 60_000;
export function useExpiredProjectCleanup({ enabled }: { enabled: boolean }) {
	const editor = useEditor();
	const inFlightRef = useRef(false);

	const reconcile = useCallback(async () => {
		if (!enabled || inFlightRef.current) return;
		inFlightRef.current = true;
		try {
			const projects = await storageService.loadAllProjects();
			const expiredIds = await findExpiredLocalProjectIds({
				projects,
				baseUrl: getCapinstaApiBaseUrl(),
			});
			if (expiredIds.length > 0) {
				await editor.project.deleteProjects({ ids: expiredIds });
			}
		} catch (error) {
			// Network/backend failures must never delete a local project.
			console.warn("Failed to reconcile expired Capinsta projects:", error);
		} finally {
			inFlightRef.current = false;
		}
	}, [editor, enabled]);

	useEffect(() => {
		if (!enabled) return;
		void reconcile();
		const interval = window.setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") void reconcile();
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [enabled, reconcile]);
}
