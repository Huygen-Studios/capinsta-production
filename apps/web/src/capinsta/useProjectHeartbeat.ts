"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { getCapinstaApiBaseUrl } from "./featureFlags";
import { CapinstaApiError, sendCapinstaProjectHeartbeat } from "./apiClient";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useProjectHeartbeat(): { isExpired: boolean } {
	const jobId = useEditor(
		(editor) => editor.project.getActiveOrNull()?.capinstaServerJobId ?? null,
	);
	const [isExpired, setIsExpired] = useState(false);
	const inFlightRef = useRef(false);

	const sendHeartbeat = useCallback(async () => {
		if (!jobId || document.visibilityState !== "visible" || inFlightRef.current)
			return;
		inFlightRef.current = true;
		try {
			await sendCapinstaProjectHeartbeat({
				baseUrl: getCapinstaApiBaseUrl(),
				jobId,
			});
		} catch (error) {
			if (error instanceof CapinstaApiError && error.status === 410) {
				setIsExpired(true);
			}
		} finally {
			inFlightRef.current = false;
		}
	}, [jobId]);

	useEffect(() => {
		setIsExpired(false);
		if (!jobId) return;

		void sendHeartbeat();
		const interval = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") void sendHeartbeat();
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [jobId, sendHeartbeat]);

	return { isExpired };
}
