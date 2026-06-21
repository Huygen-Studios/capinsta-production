import { requireUser } from "@/auth/require-user";
import { AuthStorageScope } from "@/components/auth/storage-scope";
import type { Metadata } from "next";

export const metadata: Metadata = {
	robots: { index: false, follow: false },
};

export default async function EditorLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const user = await requireUser("/editor");
	return <AuthStorageScope userId={user.id}>{children}</AuthStorageScope>;
}
