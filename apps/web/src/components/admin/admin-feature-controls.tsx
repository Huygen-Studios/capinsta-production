"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function AdminFeatureControls({
	flags,
	settings,
}: {
	flags: Array<{
		key: string;
		description: string;
		enabled: boolean;
		version: number;
	}>;
	settings: Array<{ key: string; value: unknown; description: string }>;
}) {
	const router = useRouter();
	const [reason, setReason] = useState("");
	async function mutate(payload: Record<string, unknown>) {
		const response = await fetch("/api/admin/mutations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...payload, reason }),
		});
		if (response.status === 428) {
			router.push("/admincapinsta11/mfa?step_up=1");
			return;
		}
		if (!response.ok) toast.error("Configuration update failed.");
		else {
			toast.success("Configuration updated, versioned, and audited.");
			router.refresh();
		}
	}
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="configuration-reason">Required change reason</Label>
				<Textarea
					id="configuration-reason"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
				/>
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				{flags.map((flag) => (
					<Card key={flag.key} className="border-2">
						<CardHeader>
							<CardTitle>{flag.key}</CardTitle>
							<CardDescription>
								{flag.description} · version {flag.version}
							</CardDescription>
						</CardHeader>
						<CardContent className="flex items-center justify-between">
							<span className="text-sm">
								Effective value: {flag.enabled ? "enabled" : "disabled"}
							</span>
							<Switch
								checked={flag.enabled}
								disabled={reason.trim().length < 8}
								onCheckedChange={(enabled) =>
									void mutate({
										action: "feature_flag.update",
										targetId: flag.key,
										enabled,
									})
								}
							/>
						</CardContent>
					</Card>
				))}
				{settings.map((setting) => (
					<Card key={setting.key} className="border-2">
						<CardHeader>
							<CardTitle>{setting.key}</CardTitle>
							<CardDescription>{setting.description}</CardDescription>
						</CardHeader>
						<CardContent>
							<Input
								type="number"
								defaultValue={
									typeof setting.value === "number" ? setting.value : ""
								}
								disabled={reason.trim().length < 8}
								onBlur={(event) => {
									const value = Number(event.target.value);
									if (Number.isInteger(value))
										void mutate({
											action: "setting.update",
											targetId: setting.key,
											value,
										});
								}}
							/>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
