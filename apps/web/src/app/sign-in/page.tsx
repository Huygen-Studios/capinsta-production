import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { isSafeInternalPath } from "@/auth/routes";
import { redirectAuthenticatedUser } from "@/auth/require-user";

export const metadata: Metadata = {
	title: "Sign in",
	alternates: {},
	openGraph: null,
	twitter: null,
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
	const params = await searchParams;
	const redirectPath = isSafeInternalPath(params.redirect);
	await redirectAuthenticatedUser(redirectPath);
	return (
		<SignInForm
			redirectPath={redirectPath}
			initialError={params.error ?? null}
		/>
	);
}
