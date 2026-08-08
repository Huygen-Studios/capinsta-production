"use client";

import { useEffect, useState } from "react";
import { storageService } from "@/services/storage/service";
import { serverBackedMediaAccessResolver } from "@/services/server-backed-media/access";

export function AuthStorageScope({
	userId,
	children,
}: {
	userId: string;
	children: React.ReactNode;
}) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		serverBackedMediaAccessResolver.clear();
		storageService.setUserScope({ userId });
		// The workspace must not render until its user-specific database is selected.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setReady(true);
		return () => serverBackedMediaAccessResolver.clear();
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
