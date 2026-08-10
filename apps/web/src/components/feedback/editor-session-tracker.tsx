"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
const key = "capinsta-post-editor-rating";
export function EditorSessionTracker() { const pathname = usePathname(); useEffect(() => { const current = sessionStorage.getItem(key); const prior = current ? JSON.parse(current) : null; sessionStorage.setItem(key, JSON.stringify({ startedAt: Date.now(), imports: 0, projectId: pathname.split("/").pop(), later: prior?.exited ? (prior.later ?? 0) + 1 : prior?.later })); return () => { const value = sessionStorage.getItem(key); if (value) sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(value), exited: true })); }; }, [pathname]); return null; }
export function recordMediaImports(count: number) { const value = sessionStorage.getItem(key); if (!value) return; const session = JSON.parse(value); sessionStorage.setItem(key, JSON.stringify({ ...session, imports: session.imports + count })); }
