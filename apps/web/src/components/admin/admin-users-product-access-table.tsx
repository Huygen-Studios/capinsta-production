"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import type { AdminTableRow } from "@/admin/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

const products = [
	{ id: "editor", name: "Editor" },
	{ id: "exports", name: "Exports" },
];

type BulkPreview = {
	totalUsers: number;
	successfulUsers: number;
	changedEntitlements: number;
	unchangedEntitlements: number;
	skipped: Array<{ userId: string; reason: string }>;
	failures: Array<{ userId: string; reason: string }>;
};

export function AdminUsersProductAccessTable({
	rows,
	columns,
	query,
	selectableUserIds,
}: {
	rows: AdminTableRow[];
	columns: string[];
	query?: string;
	selectableUserIds: string[];
}) {
	const router = useRouter();
	const pageIds = useMemo(
		() =>
			rows
				.map((row) => row.id)
				.filter((id): id is string => typeof id === "string"),
		[rows],
	);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [allFilteredSelected, setAllFilteredSelected] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
		() => new Set(["editor"]),
	);
	const [action, setAction] = useState<"grant" | "revoke" | "replace">("grant");
	const [reason, setReason] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [pending, setPending] = useState(false);
	const [preview, setPreview] = useState<BulkPreview | null>(null);
	const effectiveUserIds = allFilteredSelected ? selectableUserIds : [...selected];
	const selectionCount = allFilteredSelected
		? selectableUserIds.length
		: selected.size;

	function toggleUser(userId: string) {
		setAllFilteredSelected(false);
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});
	}

	function toggleCurrentPage() {
		setAllFilteredSelected(false);
		setSelected((current) => {
			const everySelected = pageIds.every((id) => current.has(id));
			return everySelected ? new Set() : new Set([...current, ...pageIds]);
		});
	}

	async function loadPreview() {
		if (effectiveUserIds.length === 0 || selectedProducts.size === 0) return;
		setPending(true);
		const response = await fetch("/api/admin/product-access/bulk", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				userIds: effectiveUserIds,
				productIds: [...selectedProducts],
				action,
				reason: reason || "Preview product access operation",
				dryRun: true,
			}),
		});
		const result = (await response.json().catch(() => null)) as
			| { preview?: BulkPreview; error?: string }
			| null;
		setPending(false);
		if (!response.ok || !result?.preview) {
			toast.error(result?.error ?? "Preview could not be loaded.");
			return;
		}
		setPreview(result.preview);
	}

	async function submit() {
		if (
			pending ||
			effectiveUserIds.length === 0 ||
			selectedProducts.size === 0 ||
			reason.trim().length < 8 ||
			(action === "replace" && confirmation !== "REPLACE")
		)
			return;
		setPending(true);
		const response = await fetch("/api/admin/product-access/bulk", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				userIds: effectiveUserIds,
				productIds: [...selectedProducts],
				action,
				reason,
			}),
		});
		const result = (await response.json().catch(() => null)) as
			| { outcome?: BulkPreview; error?: string; stepUp?: string }
			| null;
		if (response.status === 428 && result?.stepUp) {
			router.push(result.stepUp);
			return;
		}
		if (!response.ok || !result?.outcome) {
			toast.error(result?.error ?? "Bulk product access failed.");
			setPending(false);
			return;
		}
		toast.success(
			`Updated ${result.outcome.successfulUsers} users; ${result.outcome.skipped.length} skipped.`,
		);
		setPreview(result.outcome);
		setSelected(new Set());
		setAllFilteredSelected(false);
		router.refresh();
		setPending(false);
	}

	return (
		<>
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<Button type="button" variant="secondary" size="sm" onClick={toggleCurrentPage}>
					Select current page
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						setAllFilteredSelected(true);
						setSelected(new Set(pageIds));
					}}
					disabled={selectableUserIds.length === 0}
				>
					Select all filtered users
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={() => setDialogOpen(true)}
					disabled={!allFilteredSelected && selected.size === 0}
				>
					<ShieldCheck aria-hidden="true" /> Manage Product Access
				</Button>
				<span className="text-sm text-muted-foreground">
					{selectionCount} selected{query ? ` for filter "${query}"` : ""}
					{allFilteredSelected && selectableUserIds.length >= 250
						? " (first 250 eligible users)"
						: ""}
				</span>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-10">
							<Checkbox
								checked={pageIds.length > 0 && pageIds.every((id) => selected.has(id))}
								onCheckedChange={toggleCurrentPage}
								aria-label="Select all users on this page"
							/>
						</TableHead>
						{columns.map((column) => (
							<TableHead key={column}>{humanize(column)}</TableHead>
						))}
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row, rowIndex) => {
						const id = typeof row.id === "string" ? row.id : null;
						const detailHref = id
							? `/admincapinsta11/users/${encodeURIComponent(id)}`
							: null;
						return (
							<TableRow key={String(row.id ?? rowIndex)}>
								<TableCell>
									{id ? (
										<Checkbox
											checked={selected.has(id)}
											onCheckedChange={() => toggleUser(id)}
											aria-label={`Select user ${id}`}
											disabled={row.status !== "active"}
										/>
									) : null}
								</TableCell>
								{columns.map((column) => (
									<TableCell key={column} className="max-w-72 truncate font-mono text-xs">
										{column === "id" && detailHref ? (
											<Link className="font-semibold text-primary hover:underline" href={detailHref}>
												{formatValue(row[column])}
											</Link>
										) : isStatus(column) ? (
											<Badge variant="outline">{formatValue(row[column])}</Badge>
										) : (
											formatValue(row[column])
										)}
									</TableCell>
								))}
								<TableCell>
									{detailHref ? (
										<Button asChild size="sm" variant="outline">
											<Link href={detailHref}>Manage</Link>
										</Button>
									) : (
										formatValue(null)
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Manage Product Access</DialogTitle>
						<DialogDescription>
							Changes are server-authorized, audited, and applied through canonical entitlements.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<div className="grid gap-3 sm:grid-cols-2">
							{products.map((product) => (
								<label key={product.id} className="flex items-center gap-2 rounded-sm border p-3">
									<Checkbox
										checked={selectedProducts.has(product.id)}
										onCheckedChange={() =>
											setSelectedProducts((current) => {
												const next = new Set(current);
												if (next.has(product.id)) next.delete(product.id);
												else next.add(product.id);
												return next;
											})
										}
									/>
									<span>{product.name}</span>
								</label>
							))}
						</div>
						<fieldset className="grid gap-2">
							<legend className="text-sm font-semibold">Action</legend>
							{(["grant", "revoke", "replace"] as const).map((option) => (
								<label key={option} className="flex items-center gap-2">
									<input
										type="radio"
										name="bulk-product-action"
										value={option}
										checked={action === option}
										onChange={() => {
											setAction(option);
											setPreview(null);
										}}
									/>
									<span>{option === "grant" ? "Grant selected products" : option === "revoke" ? "Revoke selected products" : "Replace access with exactly selected products"}</span>
								</label>
							))}
						</fieldset>
						<div className="grid gap-2">
							<Label htmlFor="bulk-product-reason">Audit reason</Label>
							<Textarea
								id="bulk-product-reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								minLength={8}
								maxLength={1000}
							/>
						</div>
						{action === "replace" ? (
							<div className="grid gap-2 rounded-sm border-2 border-destructive/40 p-3">
								<Label htmlFor="bulk-replace-confirm">Type REPLACE to confirm destructive replacement</Label>
								<input
									id="bulk-replace-confirm"
									className="rounded-sm border-2 bg-background px-3 py-2"
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
								/>
							</div>
						) : null}
						<Button type="button" variant="secondary" onClick={() => void loadPreview()} disabled={pending}>
							Preview operation
						</Button>
						{preview ? (
							<div className="rounded-sm border bg-muted/30 p-3 text-sm">
								<p>{preview.totalUsers} selected users</p>
								<p>{preview.successfulUsers} eligible users</p>
								<p>{preview.changedEntitlements} changed entitlements</p>
								<p>{preview.unchangedEntitlements} unchanged entitlements</p>
								<p>{preview.skipped.length} skipped users</p>
								<p>{preview.failures.length} failures</p>
							</div>
						) : null}
					</DialogBody>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
							Close
						</Button>
						<Button
							type="button"
							variant={action === "replace" || action === "revoke" ? "destructive" : "default"}
							onClick={() => void submit()}
							disabled={
								pending ||
								selectedProducts.size === 0 ||
								reason.trim().length < 8 ||
								(action === "replace" && confirmation !== "REPLACE")
							}
						>
							{pending ? "Applying..." : "Apply bulk change"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function humanize(value: string) {
	return value
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (letter) => letter.toUpperCase());
}

function isStatus(column: string) {
	return ["status", "state", "severity", "role", "enabled", "active", "success", "productAccess"].includes(column);
}

function formatValue(value: string | number | boolean | null) {
	if (value === null || value === "") return "-";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
		return new Date(value).toLocaleString();
	return String(value);
}
