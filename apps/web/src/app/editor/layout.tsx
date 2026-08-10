import { requireAppPermission } from "@/access/server";
import { AuthStorageScope } from "@/components/auth/storage-scope";
import type { Metadata } from "next";
import { EditorSessionTracker } from "@/components/feedback/editor-session-tracker";

export const metadata: Metadata = {
	title: "Editor",
	alternates: {},
	openGraph: null,
	twitter: null,
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function EditorLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const context = await requireAppPermission("editor.access", "/editor");
	return <AuthStorageScope userId={context.userId}><EditorSessionTracker />{children}</AuthStorageScope>;
}
