import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ROUTES, BRAND } from "@/site/brand";
import type { Metadata } from "next";

export const metadata: Metadata = {
	robots: { index: false, follow: false, nocache: true },
};

export default function NotFound() {
	return (
		<main className="marketing-theme flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
			<section className="cap-brutal-card max-w-xl p-8 sm:p-12">
			<p className="text-sm font-bold uppercase tracking-widest text-brand">
				404
			</p>
			<h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
				Page not found
			</h1>
			<p className="mt-4 max-w-md text-muted-foreground">
				The page you&apos;re looking for doesn&apos;t exist or may have been moved.
			</p>
			<div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
				<Link href={ROUTES.home}>
					<Button variant="lime" className="font-black">
						<ArrowLeft className="mr-1 size-4" />
						Back to {BRAND.productName}
					</Button>
				</Link>
				<Link href={ROUTES.projects}>
					<Button variant="outline" className="font-medium">
						Open projects
					</Button>
				</Link>
			</div>
			</section>
		</main>
	);
}
