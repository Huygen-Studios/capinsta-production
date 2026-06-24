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
		<main className="marketing-theme min-h-screen bg-background bg-grid-paper px-4 py-10 text-foreground sm:py-16">
			<div className="mx-auto w-full max-w-md">
				<Link href="/" aria-label="Capinsta home" className="mb-8 flex justify-center">
					<LogoStatic
						variant="wordmark"
						height={32}
						alt={BRAND.productName}
						priority
					/>
				</Link>
				<section className="cap-brutal-card bg-card p-6 sm:p-8">
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
	"mt-2 h-11 w-full rounded-sm border-2 border-border bg-input px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export const primaryAuthButtonClass =
	"flex h-11 w-full translate-x-0 translate-y-0 items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryAuthButtonClass =
	"flex h-11 w-full items-center justify-center gap-3 rounded-sm border-2 border-border bg-card px-4 text-sm font-bold text-foreground shadow-[2px_2px_0_var(--shadow-strong)] transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";

export function AuthError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div
			role="alert"
			className="rounded-sm border-2 border-destructive bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive"
		>
			{message}
		</div>
	);
}
