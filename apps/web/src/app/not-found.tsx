import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ROUTES, BRAND } from "@/site/brand";

export default function NotFound() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
			<p className="text-sm font-bold uppercase tracking-widest text-brand">
				404
			</p>
			<h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
				Page not found
			</h1>
			<p className="mt-4 max-w-md text-muted-foreground">
				The page you&apos;re looking for doesn&apos;t exist or may have been moved.
			</p>
			<div className="mt-8 flex flex-col gap-3 sm:flex-row">
				<Link href={ROUTES.home}>
					<Button className="bg-brand text-brand-foreground font-semibold hover:bg-brand-strong">
						<ArrowLeft className="mr-1 size-4" />
						Back to {BRAND.productName}
					</Button>
				</Link>
				<Link href={ROUTES.projects}>
					<Button variant="outline" className="font-medium">
						Start Captioning
					</Button>
				</Link>
			</div>
		</main>
	);
}
