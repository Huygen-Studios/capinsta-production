import { SignInForm } from "./sign-in-form";
import { isSafeInternalPath } from "@/auth/routes";

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
	const params = await searchParams;
	return (
		<SignInForm
			redirectPath={isSafeInternalPath(params.redirect)}
			initialError={params.error ?? null}
		/>
	);
}
