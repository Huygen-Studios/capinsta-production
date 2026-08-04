"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorCore } from "@/core";

export function LocalClipperEntry() {
	const router = useRouter();
	const [error, setError] = useState("");

	useEffect(() => {
		void EditorCore.getInstance()
			.project.createNewProject({ name: "Untitled clips" })
			.then((projectId) => router.replace(`/editor/${projectId}?mode=clipping`))
			.catch(() => setError("The local editor could not be opened."));
	}, [router]);

	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<p
				role={error ? "alert" : "status"}
				className={error ? "text-destructive" : "text-muted-foreground"}
			>
				{error || "Opening Clipping Mode…"}
			</p>
		</main>
	);
}
