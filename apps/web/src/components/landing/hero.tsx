import { BRAND, ROUTES, FULL_DESCRIPTION } from "@/site/brand";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Hero() {
	return (
		<section className="relative overflow-hidden">
			{/* Background */}
			<div className="absolute inset-0 -z-10 bg-grid-paper bg-[length:32px_32px] bg-background" />
			<div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand/5 via-transparent to-transparent" />

			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
				<div className="flex flex-col items-center text-center">
					{/* Badge */}
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-1.5 text-sm font-medium text-brand">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
						</span>
						Free to use — no account required
					</div>

					{/* Headline */}
					<h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
						Create accurate, animated captions directly in your browser
					</h1>

					{/* Subheadline */}
					<p className="mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
						{FULL_DESCRIPTION.split(".")[0]}.
					</p>

					{/* CTAs */}
					<div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
						<Link href={ROUTES.projects}>
							<Button
								size="lg"
								className="shadow-brut-lg bg-brand text-brand-foreground text-base font-bold px-8 py-6 hover:bg-brand-strong transition-colors"
							>
								Start Captioning
								<ArrowRight className="ml-2 size-5" />
							</Button>
						</Link>
						<Link href={ROUTES.howItWorks}>
							<Button
								variant="outline"
								size="lg"
								className="text-base font-medium px-8 py-6"
							>
								See how it works
							</Button>
						</Link>
					</div>

					{/* Byline */}
					<p className="mt-8 text-sm text-muted-foreground">
						{BRAND.productByLine}
					</p>
				</div>
			</div>
		</section>
	);
}
