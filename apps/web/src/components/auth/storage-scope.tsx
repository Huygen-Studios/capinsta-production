"use client";

import { useEffect, useState } from "react";
import { storageService } from "@/services/storage/service";

export function AuthStorageScope({
	userId,
	children,
}: {
	userId: string;
	children: React.ReactNode;
}) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		storageService.setUserScope({ userId });
		// The workspace must not render until its user-specific database is selected.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setReady(true);
	}, [userId]);

	if (!ready) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<p className="text-sm text-muted-foreground">Loading your workspace…</p>
			</div>
		);
	}
	return children;
}
