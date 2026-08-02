/* eslint-disable opencut/prefer-object-params -- Tiny record accessor stays local to the upload screen. */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { LogoStatic } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
	getProjectStatus,
	prepareHandoff,
	requestConversion,
	uploadClipperMedia,
} from "@/services/automatic-clipper/api";
import {
	createClipBatch,
	getClipBatch,
	getMediaReadiness,
	type ClipBatchV1,
} from "@/services/clip-batches/api";

const RESTORE_KEY = "capinsta:manual-clip-batch-v1";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function state(value: unknown, key: string, field = "status"): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const nested = Reflect.get(value, key);
	return nested && typeof nested === "object" ? String(Reflect.get(nested, field)) : undefined;
}

export function ManualClipperWorkspace() {
	const router = useRouter();
	const abort = useRef<AbortController | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("Choose one source video to begin.");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	async function openBatch(batch: ClipBatchV1) {
		if (!batch.sourceProjectId) throw new Error("The source editor project was not created.");
		const projectId = batch.sourceProjectId;
		let converted = false;
		let conversionRequested = false;
		let revision = 1;
		for (let attempt = 0; attempt < 600; attempt += 1) {
			const status = await getProjectStatus(projectId);
			revision = Number(status.projectRevision ?? revision);
			if (["current", "succeeded"].includes(state(status, "conversion") ?? "")) {
				converted = true;
				break;
			}
			if (state(status, "derivation") === "failed" || state(status, "conversion") === "failed")
				throw new Error("The editable source project could not be prepared.");
			if (!conversionRequested && (state(status, "derivation") === "succeeded" || state(status, "derivation", "edl") === "current")) {
				setMessage("Opening the full editor…");
				await requestConversion(projectId, revision, `clipper-source-${batch.id}`, false);
				conversionRequested = true;
			}
			await wait(1_000);
		}
		if (!converted) throw new Error("Preparing the editor timed out. You can safely retry.");
		const handoff = await prepareHandoff(projectId, revision, `clipper-source-${batch.id}`, false);
		router.push(`/editor/handoff/${encodeURIComponent(handoff.handoffId)}?clipBatch=${encodeURIComponent(batch.id)}`);
	}

	useEffect(() => {
		const batchId = window.localStorage.getItem(RESTORE_KEY);
		if (!batchId) return;
		void getClipBatch(batchId)
			.then(openBatch)
			.catch(() => window.localStorage.removeItem(RESTORE_KEY))
			.finally(() => setBusy(false));
		// Restoration intentionally runs once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function start() {
		if (!file || busy) return;
		abort.current?.abort();
		abort.current = new AbortController();
		setBusy(true);
		setError("");
		try {
			setMessage("Uploading your source video…");
			const mediaAssetId = await uploadClipperMedia({ file, onProgress: setProgress, signal: abort.current.signal });
			setMessage("Preparing your video…");
			let ready = false;
			for (let attempt = 0; attempt < 600; attempt += 1) {
				const media = await getMediaReadiness(mediaAssetId);
				if (media.ready) {
					ready = true;
					break;
				}
				await wait(1_000);
			}
			if (!ready) throw new Error("Video preparation timed out. You can safely retry.");
			setMessage("Creating your editor workspace…");
			const batch = await createClipBatch({ sourceMediaAssetId: mediaAssetId, title: file.name.replace(/\.[^.]+$/, "") });
			window.localStorage.setItem(RESTORE_KEY, batch.id);
			await openBatch(batch);
		} catch (cause) {
			if (!abort.current?.signal.aborted)
				setError(cause instanceof Error ? cause.message : "The clipper could not continue.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="min-h-screen bg-background">
			<header className="flex h-20 items-center justify-between border-b px-6">
				<div className="flex items-center gap-3"><LogoStatic className="size-9" /><div><h1 className="font-semibold">CapInsta Clipper</h1><p className="text-xs text-muted-foreground">Manual multi-clip editor</p></div></div>
				<AccountMenu />
			</header>
			<div className="mx-auto flex max-w-2xl flex-col gap-4 p-6 pt-16">
				<Card>
					<CardHeader><CardTitle role="heading" aria-level={2}>Create clips from one video</CardTitle></CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">Upload once, mark independent ranges in the full editor, then export one or all clips. Automatic analysis and whole-video transcription stay off.</p>
						<Input type="file" accept="video/*" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
						{busy ? <><Progress value={progress || undefined} /><p className="text-sm" role="status">{message}</p></> : null}
						{error ? <p className="rounded border border-destructive p-3 text-sm text-destructive" role="alert">{error}</p> : null}
						<Button className="w-full" disabled={!file || busy} onClick={() => void start()}>Open in editor</Button>
					</CardContent>
				</Card>
				<Button variant="outline" asChild><Link href="/clipper/automatic">Suggest clips with AI (legacy)</Link></Button>
			</div>
		</main>
	);
}
