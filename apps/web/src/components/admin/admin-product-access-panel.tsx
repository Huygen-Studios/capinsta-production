"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ShieldMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Product = {
	id: string;
	name: string;
	description: string;
	state: "Granted" | "Not Granted" | "Inherited" | "Expired" | "Disabled";
	entitlementStatus: string | null;
	expiresAt: string | null;
	source: string;
};

type AccessView = {
	userId: string;
	products: Product[];
};

export function AdminProductAccessPanel({
	initialAccess,
	canManage,
}: {
	initialAccess: AccessView;
	canManage: boolean;
}) {
	const router = useRouter();
	const [access, setAccess] = useState(initialAccess);
	const [selected, setSelected] = useState<Set<string>>(
		() =>
			new Set(
				initialAccess.products
					.filter((product) => product.state === "Granted")
					.map((product) => product.id),
			),
	);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);
	const allSelected = selected.size === access.products.length;
	const selectedProducts = useMemo(() => [...selected], [selected]);

	function toggle(productId: string) {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(productId)) next.delete(productId);
			else next.add(productId);
			return next;
		});
	}

	async function save(action: "grant" | "revoke" | "replace") {
		if (pending || selectedProducts.length === 0 || reason.trim().length < 8)
			return;
		setPending(true);
		const response = await fetch(
			`/api/admin/users/${encodeURIComponent(access.userId)}/product-access`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action,
					productIds: selectedProducts,
					reason,
				}),
			},
		);
		const result = (await response.json().catch(() => null)) as
			| { access?: AccessView; error?: string; stepUp?: string }
			| null;
		if (response.status === 428 && result?.stepUp) {
			router.push(result.stepUp);
			return;
		}
		if (!response.ok || !result?.access) {
			toast.error(result?.error ?? "Product access could not be saved.");
			setPending(false);
			return;
		}
		setAccess(result.access);
		setSelected(
			new Set(
				result.access.products
					.filter((product) => product.state === "Granted")
					.map((product) => product.id),
			),
		);
		setReason("");
		toast.success("Product access updated.");
		router.refresh();
		setPending(false);
	}

	return (
		<Card className="mt-6 border-2">
			<CardHeader>
				<CardTitle>Product Access</CardTitle>
				<CardDescription>
					Direct grants are enforced by the same authorization service that protects product routes and APIs.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="grid gap-3 md:grid-cols-2">
					{access.products.map((product) => (
						<label
							key={product.id}
							className="flex min-h-36 gap-3 rounded-sm border-2 p-4"
						>
							<Checkbox
								checked={selected.has(product.id)}
								onCheckedChange={() => toggle(product.id)}
								disabled={!canManage || pending}
								aria-label={`Select ${product.name}`}
							/>
							<span className="min-w-0 flex-1">
								<span className="flex items-center justify-between gap-2">
									<span className="font-semibold">{product.name}</span>
									<Badge variant="outline">{product.state}</Badge>
								</span>
								<span className="mt-2 block text-sm text-muted-foreground">
									{product.description}
								</span>
								<span className="mt-3 block text-xs font-mono text-muted-foreground">
									{product.id} · {product.source}
									{product.expiresAt ? ` · expires ${new Date(product.expiresAt).toLocaleString()}` : ""}
								</span>
							</span>
						</label>
					))}
				</div>
				{canManage ? (
					<div className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() =>
									setSelected(
										allSelected
											? new Set()
											: new Set(access.products.map((product) => product.id)),
									)
								}
							>
								{allSelected ? "Clear products" : "Select all products"}
							</Button>
							<span className="text-sm text-muted-foreground">
								{selected.size} selected
							</span>
						</div>
						<div className="space-y-2">
							<Label htmlFor="product-access-reason">Audit reason</Label>
							<Textarea
								id="product-access-reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								minLength={8}
								maxLength={1000}
								required
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								onClick={() => void save("grant")}
								disabled={pending || selected.size === 0 || reason.trim().length < 8}
							>
								<ShieldCheck aria-hidden="true" /> {pending ? "Saving..." : "Grant selected"}
							</Button>
							<Button
								type="button"
								variant="destructive"
								onClick={() => void save("revoke")}
								disabled={pending || selected.size === 0 || reason.trim().length < 8}
							>
								<ShieldMinus aria-hidden="true" /> Revoke selected
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => void save("replace")}
								disabled={pending || selected.size === 0 || reason.trim().length < 8}
							>
								Replace with selected
							</Button>
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Your administrator role can view product access but cannot change it.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
