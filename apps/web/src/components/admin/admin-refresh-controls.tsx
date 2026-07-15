"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function AdminRefreshControls() {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [seconds, setSeconds] = useState(0);
	const [updatedAt, setUpdatedAt] = useState(() => new Date());
	function refresh() {
		if (pending) return;
		startTransition(() => {
			router.refresh();
			setUpdatedAt(new Date());
			toast.success("Admin data refreshed.");
		});
	}
	useEffect(() => {
		if (!seconds) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") refresh();
		}, seconds * 1000);
		return () => window.clearInterval(timer);
	// refresh intentionally reads the latest transition state each interval tick.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seconds]);
	return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		<span>Updated {updatedAt.toLocaleTimeString()}</span>
		<select aria-label="Auto refresh" className="h-8 rounded-sm border-2 bg-background px-2" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
			<option value={0}>Auto: Off</option><option value={30}>Auto: 30s</option><option value={60}>Auto: 60s</option><option value={300}>Auto: 5m</option>
		</select>
		<Button type="button" size="sm" variant="outline" disabled={pending} onClick={refresh}><RefreshCw className={pending ? "animate-spin" : undefined} />{pending ? "Refreshing…" : "Refresh"}</Button>
	</div>;
}
