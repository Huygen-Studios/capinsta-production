"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { CreditCard, LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountMenu({ compact = false }: { compact?: boolean }) {
	const router = useRouter();
	const [user, setUser] = useState<User | null>(null);
	const [resolved, setResolved] = useState(false);

	useEffect(() => {
		const supabase = createClient();
		void supabase.auth.getUser().then(({ data }) => {
			setUser(data.user);
			setResolved(true);
		});
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null);
			setResolved(true);
		});
		return () => subscription.unsubscribe();
	}, []);

	if (!resolved) return <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />;
	if (!user) {
		return (
			<Link href="/sign-in">
				<Button size="sm" variant="outline">Sign in</Button>
			</Link>
		);
	}

	const name =
		(typeof user.user_metadata.full_name === "string" &&
			user.user_metadata.full_name) ||
		user.email ||
		"Account";
	const avatar =
		typeof user.user_metadata.avatar_url === "string"
			? user.user_metadata.avatar_url
			: null;

	const signOut = async () => {
		await createClient().auth.signOut({ scope: "global" });
		router.replace("/sign-in");
		router.refresh();
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					aria-label={`Open account menu for ${name}`}
					className="h-9 gap-2 rounded-full px-2"
				>
					{avatar ? (
						<Image
							src={avatar}
							alt=""
							width={28}
							height={28}
							className="size-7 rounded-full object-cover"
						/>
					) : (
						<span className="flex size-7 items-center justify-center rounded-full border-2 border-[var(--neo-black)] bg-[var(--neo-blue)] text-[var(--neo-black)]">
							<UserRound className="size-4" />
						</span>
					)}
					{compact ? null : (
						<span className="hidden max-w-40 truncate text-sm sm:block">{name}</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<div className="px-2 py-2">
					<p className="truncate text-sm font-medium">{name}</p>
					<p className="truncate text-xs text-muted-foreground">{user.email}</p>
				</div>
				<DropdownMenuItem asChild>
					<Link href="/account">
						<CreditCard className="size-4" />
						Account & billing
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => void signOut()}>
					<LogOut className="size-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
