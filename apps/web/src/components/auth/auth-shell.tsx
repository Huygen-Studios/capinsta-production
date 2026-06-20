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
		<main className="min-h-screen bg-[#09090b] px-4 py-10 text-zinc-100 sm:py-16">
			<div className="mx-auto w-full max-w-md">
				<Link href="/" className="mb-8 flex justify-center">
					<LogoStatic
						variant="wordmark"
						height={32}
						alt={BRAND.productName}
						priority
					/>
				</Link>
				<section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl shadow-black/30 sm:p-8">
					<div className="mb-7 text-center">
						<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
						<p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
					</div>
					{children}
				</section>
			</div>
		</main>
	);
}

export const authInputClass =
	"mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60";

export const primaryAuthButtonClass =
	"flex h-11 w-full items-center justify-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryAuthButtonClass =
	"flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60";

export function AuthError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div
			role="alert"
			className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-sm text-red-300"
		>
			{message}
		</div>
	);
}
