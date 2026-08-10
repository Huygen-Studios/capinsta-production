"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
const key = "capinsta-post-editor-rating";
export function PostEditorRatingModal() {
	const session = typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
	const data = session ? JSON.parse(session) as { startedAt: number; imports: number; exited: boolean; later?: number } : null;
	const [open, setOpen] = useState(false);
	useEffect(() => { if (data?.exited && data.imports > 0 && Date.now() - data.startedAt >= 60_000 && (data.later === undefined || data.later >= 3)) fetch("/api/ratings").then((r) => r.json()).then((r) => setOpen(Boolean(r.canRate))).catch(() => undefined); }, []);
	const [rating, setRating] = useState(0); const [comment, setComment] = useState("");
	if (!open) return null;
	const close = (later = false) => { if (later) sessionStorage.setItem(key, JSON.stringify({ ...data, exited: false, later: 0 })); else sessionStorage.removeItem(key); setOpen(false); };
	return <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-4 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="rating-title"><div className="w-full max-w-[520px] rounded-sm border-2 border-border bg-card p-6 shadow-[5px_5px_0_var(--shadow-strong)]"><h2 id="rating-title" className="text-xl font-black">How’s CapInsta working for you so far?</h2><div className="mt-5 flex gap-2" aria-label="Rating">{[1,2,3,4,5].map((star) => <button key={star} type="button" className={`text-4xl ${star <= rating ? "text-primary" : "text-muted-foreground"}`} onClick={() => setRating(star)} aria-label={`${star} stars`}>★</button>)}</div><label className="mt-5 block text-sm font-semibold">What’s the one thing you expected to work better?<textarea value={comment} onChange={(e) => setComment(e.target.value)} className="mt-2 min-h-24 w-full rounded-sm border bg-background p-3 font-normal" /></label><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => close(true)}>Maybe later</Button><Button variant="lime" disabled={!rating} onClick={async () => { const r = await fetch("/api/ratings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, comment }) }); if (r.ok) close(); }}>Send feedback</Button></div></div></div>;
}
