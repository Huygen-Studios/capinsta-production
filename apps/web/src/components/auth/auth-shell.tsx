import Link from "next/link";
import { LogoStatic } from "@/components/logo";
import { BRAND } from "@/site/brand";

export function AuthShell({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<main className="marketing-theme min-h-screen bg-background px-4 py-10 text-foreground sm:py-16">
			<div className="mx-auto w-full max-w-md">
				<Link href="/" aria-label="Capinsta home" className="mb-8 flex justify-center">
					<LogoStatic
						variant="wordmark"
						height={32}
						alt={BRAND.productName}
						priority
					/>
				</Link>
				<section className="cap-brutal-card p-6 sm:p-8">
					<div className="mb-7 text-center">
						<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
					</div>
					{children}
				</section>
			</div>
		</main>
	);
}

export const authInputClass =
	"mt-2 h-11 w-full rounded-lg border-2 border-border bg-input px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-3 focus:ring-primary/20 disabled:opacity-60";

export const primaryAuthButtonClass =
	"flex h-11 w-full items-center justify-center rounded-lg border-2 border-[var(--cap-outline)] bg-[var(--cap-lime)] px-4 text-sm font-black text-[#111] shadow-[3px_3px_0_var(--cap-shadow-color)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryAuthButtonClass =
	"flex h-11 w-full items-center justify-center gap-3 rounded-lg border-2 border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

export function AuthError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div
			role="alert"
			className="rounded-lg border-2 border-destructive/60 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
		>
			{message}
		</div>
	);
}
