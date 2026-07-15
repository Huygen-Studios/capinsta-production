"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SiteAccessMode } from "@/access/permissions";

export function AdminSiteModeForm({
	mode,
	confirmation,
}: {
	mode: SiteAccessMode;
	confirmation: string;
}) {
	const router = useRouter();
	const [reason, setReason] = useState("");
	const [typed, setTyped] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (typed !== mode || reason.trim().length < 8 || pending) return;
		setPending(true);
		const response = await fetch("/api/admin/mutations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "access.site_mode.update",
				targetId: "global",
				mode,
				confirmation: typed,
				reason,
			}),
		});
		if (response.status === 428) {
			router.push("/admincapinsta11/mfa?step_up=1");
			return;
		}
		if (!response.ok) {
			toast.error("Site mode could not be changed.");
			setPending(false);
			return;
		}
		toast.success("Site mode changed and audited.");
		router.refresh();
		setPending(false);
	}

	return (
		<form className="grid gap-3" onSubmit={submit}>
			<p className="text-sm text-muted-foreground">{confirmation}</p>
			<Label className="grid gap-2 text-sm">
				Written reason
				<Textarea
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					minLength={8}
					maxLength={1000}
					required
				/>
			</Label>
			<Label className="grid gap-2 text-sm">
				Type {mode} to confirm
				<Input
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					required
				/>
			</Label>
			<Button
				type="submit"
				disabled={pending || typed !== mode || reason.trim().length < 8}
			>
				{pending ? "Changing..." : `Switch to ${mode.replace("_", " ")}`}
			</Button>
		</form>
	);
}

export function AdminSignupPolicyForm({
	allowSignups,
}: {
	allowSignups: boolean;
}) {
	const router = useRouter();
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);
	const nextAllowSignups = !allowSignups;

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (reason.trim().length < 8 || pending) return;
		setPending(true);
		const response = await fetch("/api/admin/mutations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "access.signup_policy.update",
				targetId: "global",
				allowSignups: nextAllowSignups,
				reason,
			}),
		});
		if (response.status === 428) {
			router.push("/admincapinsta11/mfa?step_up=1");
			return;
		}
		if (!response.ok) {
			toast.error("Signup policy could not be changed.");
			setPending(false);
			return;
		}
		toast.success(nextAllowSignups ? "Signups resumed." : "Signups paused.");
		router.refresh();
		setPending(false);
	}

	return (
		<form className="grid gap-3" onSubmit={submit}>
			<p className="text-sm text-muted-foreground">
				{allowSignups
					? "Pause new email and Google account creation globally. Existing users can still sign in."
					: "Resume new account creation globally."}
			</p>
			<Label className="grid gap-2 text-sm">
				Written reason
				<Textarea
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					minLength={8}
					maxLength={1000}
					required
				/>
			</Label>
			<Button type="submit" disabled={pending || reason.trim().length < 8}>
				{pending
					? "Saving..."
					: allowSignups
						? "Pause signups"
						: "Resume signups"}
			</Button>
		</form>
	);
}
