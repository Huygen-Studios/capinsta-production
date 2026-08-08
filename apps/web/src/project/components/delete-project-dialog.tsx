import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

export function DeleteProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectNames,
	isDeleting = false,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void | Promise<void>;
	projectNames: string[];
	isDeleting?: boolean;
}) {
	const [confirmation, setConfirmation] = useState("");
	useEffect(() => {
		if (!isOpen) setConfirmation("");
	}, [isOpen]);
	const count = projectNames.length;
	const isSingle = count === 1;
	const singleName = isSingle ? projectNames[0] : null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{singleName ? (
							<>
								{"Delete '"}
								<span className="inline-block max-w-[300px] truncate align-bottom">
									{singleName}
								</span>
								{"'?"}
							</>
						) : (
							`Delete ${count} projects?`
						)}
					</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<Alert variant="destructive">
						<AlertTitle>Warning</AlertTitle>
						<AlertDescription>
							This will permanently delete{" "}
							{singleName ? `"${singleName}"` : `${count} projects`} and all
							associated media, captions, and exports. Anonymous operational
							metadata remains for account and admin history.
						</AlertDescription>
					</Alert>
					<div className="flex flex-col gap-3">
						<Label className="text-xs font-semibold text-slate-500">
							Type "DELETE" to confirm
						</Label>
						<Input
							type="text"
							placeholder="DELETE"
							size="lg"
							variant="destructive"
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							disabled={isDeleting}
						/>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isDeleting}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={() => void onConfirm()}
						disabled={confirmation !== "DELETE" || isDeleting}
					>
						{isDeleting ? "Deleting…" : "Delete project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
