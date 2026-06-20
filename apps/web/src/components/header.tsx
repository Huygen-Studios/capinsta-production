"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { LogoStatic } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { ROUTES, BRAND } from "@/site/brand";
import { SOCIAL_LINKS } from "@/site/social";
import {
	Menu02Icon,
	Cancel01Icon,
	GithubIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AccountMenu } from "@/components/auth/account-menu";

const NAV_LINKS = [
	{ label: "Features", href: ROUTES.features },
	{ label: "How It Works", href: ROUTES.howItWorks },
	{ label: "Guides", href: ROUTES.guides },
	{ label: "FAQ", href: ROUTES.faq },
	{ label: "About", href: ROUTES.about },
	{ label: "Contact", href: ROUTES.contact },
];

export function Header() {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const closeMenu = () => setIsMenuOpen(false);

	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
				{/* Logo + nav */}
				<div className="flex items-center gap-8">
					<Link href={ROUTES.home} className="flex items-center gap-2.5">
						<LogoStatic variant="wordmark" height={28} alt={BRAND.productName} priority />
					</Link>
					<nav className="hidden items-center gap-1 lg:flex">
						{NAV_LINKS.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors"
							>
								{link.label}
							</Link>
						))}
					</nav>
				</div>

				{/* Right side */}
				<div className="flex items-center gap-3">
					{SOCIAL_LINKS.github && (
						<Link
							href={SOCIAL_LINKS.github}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground hover:text-foreground transition-colors"
							aria-label={`${BRAND.productName} on GitHub`}
						>
							<HugeiconsIcon icon={GithubIcon} className="size-5" />
						</Link>
					)}
					<div className="hidden items-center gap-3 sm:flex">
						<Link href={ROUTES.projects}>
							<Button size="sm" className="bg-brand text-brand-foreground text-sm font-semibold hover:bg-brand-strong">
								Start Captioning
							</Button>
						</Link>
					</div>
					<AccountMenu compact />
					<ThemeToggle />
					{/* Mobile hamburger */}
					<Button
						variant="ghost"
						size="icon"
						className="lg:hidden"
						onClick={() => setIsMenuOpen(!isMenuOpen)}
						aria-label={isMenuOpen ? "Close menu" : "Open menu"}
					>
						{isMenuOpen ? (
							<HugeiconsIcon icon={Cancel01Icon} size={22} />
						) : (
							<HugeiconsIcon icon={Menu02Icon} size={22} />
						)}
					</Button>
				</div>
			</div>

			{/* Mobile nav overlay */}
			{isMenuOpen && (
				<div className="border-t border-border bg-background lg:hidden">
					<nav className="mx-auto max-w-7xl flex flex-col gap-1 px-4 py-4">
						{NAV_LINKS.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								onClick={closeMenu}
								className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2.5 text-base font-medium transition-colors"
							>
								{link.label}
							</Link>
						))}
						<div className="mt-4 border-t border-border pt-4">
							<Link href={ROUTES.projects} onClick={closeMenu}>
								<Button className="w-full bg-brand text-brand-foreground font-semibold hover:bg-brand-strong">
									Start Captioning
								</Button>
							</Link>
						</div>
					</nav>
				</div>
			)}
		</header>
	);
}
