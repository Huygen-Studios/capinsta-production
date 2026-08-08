"use client";

import { useEffect, useState } from "react";

export function usePublicRuntimeFlag({
	key,
	fallback = false,
}: {
	key: string;
	fallback?: boolean;
}) {
	const [enabled, setEnabled] = useState(fallback);

	useEffect(() => {
		const controller = new AbortController();
		void fetch("/api/runtime-config", {
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) return;
				const payload: unknown = await response.json();
				if (
					typeof payload === "object" &&
					payload !== null &&
					"flags" in payload &&
					typeof payload.flags === "object" &&
					payload.flags !== null
				) {
					const value = Reflect.get(payload.flags, key);
					if (typeof value === "boolean") setEnabled(value);
				}
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, [key]);

	return enabled;
}
