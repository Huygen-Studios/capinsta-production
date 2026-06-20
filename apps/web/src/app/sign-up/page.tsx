import { isSafeInternalPath } from "@/auth/routes";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string }>;
}) {
	const params = await searchParams;
	return <SignUpForm redirectPath={isSafeInternalPath(params.redirect)} />;
}
