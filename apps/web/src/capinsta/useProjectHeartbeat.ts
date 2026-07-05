"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { getCapinstaApiBaseUrl } from "./featureFlags";
import { CapinstaApiError, getCapinstaJob, sendCapinstaProjectHeartbeat } from "./apiClient";
import {
	acceptCapinstaJobLifecycleUpdate,
	isKnownTerminalCapinstaJob,
	lifecycleStateFromJob,
	type CapinstaJobLifecycleState,
} from "./captionJobLifecycle";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useProjectHeartbeat(): { isExpired: boolean } {
	const jobId = useEditor(
		(editor) => editor.project.getActiveOrNull()?.capinstaServerJobId ?? null,
	);
	const [isExpired, setIsExpired] = useState(false);
	const inFlightRef = useRef(false);
	const terminalRef = useRef(false);
	const lifecycleRef = useRef<CapinstaJobLifecycleState | null>(null);

	const sendHeartbeat = useCallback(async () => {
		if (
			!jobId ||
			terminalRef.current ||
			isKnownTerminalCapinstaJob(jobId) ||
			document.visibilityState !== "visible" ||
			inFlightRef.current
		)
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
		terminalRef.current = false;
		lifecycleRef.current = null;
		if (!jobId) return;

		let disposed = false;
		const reconcileActiveJob = async () => {
			try {
				const job = await getCapinstaJob({
					baseUrl: getCapinstaApiBaseUrl(),
					jobId,
				});
				if (disposed) return;
				const nextLifecycle = lifecycleStateFromJob(job, "heartbeat");
				const accepted = acceptCapinstaJobLifecycleUpdate(
					lifecycleRef.current,
					nextLifecycle,
				);
				lifecycleRef.current = accepted.state;
				if (lifecycleRef.current.terminalAt) {
					terminalRef.current = true;
					console.debug("[Capinsta heartbeat] Heartbeat stopped after terminal status", {
						jobId,
						status: lifecycleRef.current.status,
					});
				}
			} catch (error) {
				if (error instanceof CapinstaApiError && error.status === 404) {
					terminalRef.current = true;
					console.debug("[Capinsta heartbeat] Heartbeat stopped after missing backend job", {
						jobId,
					});
				}
			}
		};

		void reconcileActiveJob().then(() => {
			if (!disposed) void sendHeartbeat();
		});
		const interval = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") void sendHeartbeat();
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			disposed = true;
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [jobId, sendHeartbeat]);

	return { isExpired };
}
