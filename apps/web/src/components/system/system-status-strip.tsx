"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";

type Status = { title: string; severity: string; items: string[] };

export function SystemStatusStrip() {
	const [status, setStatus] = useState<Status | null>(null);
	const [mount, setMount] = useState<HTMLElement | null>(null);
	useEffect(() => {
		const load = async () => setStatus(await fetch("/api/system/status").then((r) => r.ok ? r.json() : null).catch(() => null));
		void load(); const interval = window.setInterval(() => void load(), 60_000);
		return () => window.clearInterval(interval);
	}, []);
	useEffect(() => { const header = document.querySelector("header"); if (!header) return; const anchor = document.createElement("div"); header.after(anchor); setMount(anchor); return () => anchor.remove(); }, []);
	if (!status || !mount) return null;
	return createPortal(<aside role="status" className="relative z-30 h-10 overflow-x-auto border-b border-primary bg-[#151515] text-[#f5f5f5] [scrollbar-width:none] animate-in fade-in slide-in-from-top-1 duration-150"><div className="mx-auto flex h-full w-max min-w-full items-center gap-3 whitespace-nowrap px-4 text-sm"><CircleAlert className="size-4 shrink-0 text-primary" /><strong>{status.title}</strong>{status.items.map((item) => <span key={item} className="text-white/80">• {item}</span>)}</div></aside>, mount);
}
