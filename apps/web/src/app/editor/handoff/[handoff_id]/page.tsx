"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	isCapinstaProjectHandoffEnabled,
	isServerBackedEditorMediaEnabled,
} from "@/capinsta/featureFlags";
import { bootstrapHandoff } from "@/services/clipping-handoff/bootstrap";

export default function ProjectHandoffPage() {
	const params = useParams<{ handoff_id: string }>();
	const router = useRouter();
	const started = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const enabled =
		isCapinstaProjectHandoffEnabled() &&
		isServerBackedEditorMediaEnabled();

	useEffect(() => {
		if (!enabled || started.current) return;
		started.current = true;
		setError(null);
		void bootstrapHandoff({ handoffId: params.handoff_id })
			.then(({ projectId }) =>
				router.replace(`/editor/${encodeURIComponent(projectId)}`),
			)
			.catch((cause: unknown) => {
				setError(
					cause instanceof Error
						? cause.message
						: "The project could not be imported.",
				);
			});
	}, [attempt, enabled, params.handoff_id, router]);

	if (!enabled) {
		return <HandoffError message="Project handoff is not enabled." />;
	}
	if (error) {
		return (
			<HandoffError
				message={safeErrorMessage(error)}
				onRetry={() => {
					started.current = false;
					setAttempt((value) => value + 1);
				}}
			/>
		);
	}
	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="text-center" role="status">
				<h1 className="text-lg font-semibold">Opening your editable project</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Attaching the original media securely…
				</p>
			</div>
		</main>
	);
}

function HandoffError({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="max-w-md text-center" role="alert">
				<h1 className="text-lg font-semibold">Project could not be opened</h1>
				<p className="mt-2 text-sm text-muted-foreground">{message}</p>
				{onRetry ? (
					<Button className="mt-5" onClick={onRetry}>
						Try again
					</Button>
				) : null}
			</div>
		</main>
	);
}

function safeErrorMessage(code: string): string {
	if (code === "handoff_project_conflict") {
		return "A different project already uses this project ID. Your existing project was not overwritten.";
	}
	if (code.includes("expired")) return "This project handoff has expired.";
	if (code.includes("media")) return "The original media is not available.";
	return "The handoff could not be completed. You can safely retry.";
}
