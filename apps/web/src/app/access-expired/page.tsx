import Link from "next/link";
import { requireAuthenticatedUser } from "@/access/server";
import { LogoStatic } from "@/components/logo";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function Page() {
	const context = await requireAuthenticatedUser("/access-expired");
	return <main className="grid min-h-svh place-items-center bg-background px-6"><section className="w-full max-w-lg rounded-md border-2 bg-card p-6"><LogoStatic variant="wordmark" height={36} alt="Capinsta" priority /><h1 className="mt-8 font-display text-3xl font-black">Your product access has expired.</h1><p className="mt-3 text-muted-foreground">Your projects remain safe. Contact support if you believe this expiry is incorrect.</p><p className="mt-5 font-mono text-sm">{context.email ?? context.userId}</p><Button asChild className="mt-6"><Link href="/contact">Contact support</Link></Button></section></main>;
}
