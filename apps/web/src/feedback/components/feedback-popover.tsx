"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ClockIcon } from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
	MAX_FEEDBACK_CHARACTERS,
	validateFeedbackMessage,
} from "@/feedback/validation";
import {
	Form,
	FormField,
	FormItem,
	FormControl,
	clearFormDraft,
} from "@/components/ui/form";
import type { FeedbackEntry } from "../types";

const PERSIST_KEY = "feedback-draft";
const HISTORY_KEY = "feedback-history";
const MAX_HISTORY = 20;

interface FeedbackFormValues {
	message: string;
}

function readHistory(): FeedbackEntry[] {
	try {
		const stored = localStorage.getItem(HISTORY_KEY);
		if (!stored) return [];
		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is FeedbackEntry =>
				typeof entry === "object" &&
				entry !== null &&
				"id" in entry &&
				typeof entry.id === "string" &&
				"message" in entry &&
				typeof entry.message === "string" &&
				"createdAt" in entry &&
				typeof entry.createdAt === "string",
		);
	} catch {
		return [];
	}
}

function writeHistory({ entries }: { entries: FeedbackEntry[] }): void {
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
	} catch {
		// localStorage may be full or unavailable
	}
}

function useFeedback() {
	const [entries, setEntries] = useState<FeedbackEntry[]>(readHistory);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function submit({
		values,
		onSuccess,
	}: {
		values: FeedbackFormValues;
		onSuccess: () => void;
	}) {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(values),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(
					`${data?.error ?? "Failed to submit"} (HTTP ${res.status})`,
				);
			}

			const { entry } = await res.json();
			const next = [entry, ...entries].slice(0, MAX_HISTORY);
			setEntries(next);
			writeHistory({ entries: next });
			onSuccess();
			toast.success("Feedback sent");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to send feedback",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return { entries, isSubmitting, submit };
}

export function FeedbackPopover() {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					data-tour="send-feedback"
					className="h-8 border-[var(--editor-border)] bg-[var(--editor-surface-raised)] px-3 text-[13px] font-semibold text-[var(--editor-text)] shadow-none hover:bg-[var(--editor-surface)] hover:text-[var(--editor-text)]"
				>
					Send feedback
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<FeedbackPopoverContent onClose={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
}

type View = "compose" | "history";

function FeedbackPopoverContent({ onClose }: { onClose: () => void }) {
	const { entries, isSubmitting, submit } = useFeedback();
	const [view, setView] = useState<View>("compose");
	const [submitAttempted, setSubmitAttempted] = useState(false);

	const form = useForm<FeedbackFormValues>({
		defaultValues: { message: "" },
	});

	const message = useWatch({ control: form.control, name: "message" }) ?? "";
	const messageValidation = validateFeedbackMessage(message);
	const remaining = MAX_FEEDBACK_CHARACTERS - message.length;
	const isNearLimit = remaining <= 120;
	const canSubmit = messageValidation.ok && !isSubmitting;

	async function handleSubmit(values: FeedbackFormValues) {
		setSubmitAttempted(true);
		const validation = validateFeedbackMessage(values.message);
		if (!validation.ok) return;
		await submit({
			values,
			onSuccess: () => {
				form.reset({ message: "" });
				setSubmitAttempted(false);
				clearFormDraft({ key: PERSIST_KEY });
				onClose();
			},
		});
	}

	if (view === "history") {
		return (
			<div className="flex flex-col">
				<div
					className="max-h-72 overflow-y-auto divide-y"
					style={{
						maskImage:
							"linear-gradient(to bottom, black 80%, transparent 100%)",
					}}
				>
					{entries.map((entry) => (
						<FeedbackEntryItem key={entry.id} entry={entry} />
					))}
				</div>
				<div className="border-t px-3 py-2">
					<button
						type="button"
						onClick={() => setView("compose")}
						className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
					>
						← Back
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<Form persistKey={PERSIST_KEY} {...form}>
				<form
					onSubmit={form.handleSubmit(handleSubmit)}
					className="flex flex-col"
					noValidate
				>
					<FormField
						control={form.control}
						name="message"
						render={({ field }) => (
							<FormItem>
								<FormControl>
									<Textarea
										placeholder="Thoughts, bugs, ideas..."
										maxLength={MAX_FEEDBACK_CHARACTERS}
										aria-describedby="feedback-message-help feedback-character-count"
										aria-invalid={submitAttempted && !messageValidation.ok}
										className="min-h-[7rem] resize-none border-none! bg-background p-3 text-sm shadow-none"
										{...field}
									/>
								</FormControl>
							</FormItem>
						)}
					/>
					<div className="flex items-center justify-between gap-3 border-t px-3 py-2">
						<div className="min-w-0 flex-1">
							<p
								id="feedback-message-help"
								className="text-xs text-muted-foreground"
								aria-live="polite"
							>
								{submitAttempted && !messageValidation.ok
									? messageValidation.message
									: "Minimum 10 characters."}
							</p>
							<p
								id="feedback-character-count"
								className={`mt-1 text-[11px] ${
									isNearLimit ? "text-caution" : "text-muted-foreground/70"
								}`}
							>
								{message.length.toLocaleString()} /{" "}
								{MAX_FEEDBACK_CHARACTERS.toLocaleString()}
							</p>
						</div>
						{entries.length > 0 ? (
							<button
								type="button"
								onClick={() => setView("history")}
								className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
							>
								<ClockIcon className="size-3" />
								{entries.length}
							</button>
						) : (
							<span />
						)}
						<div className="flex shrink-0 gap-2">
							{!message.trim() && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onClose}
								>
									Cancel
								</Button>
							)}
							<Button
								type="submit"
								size="sm"
								disabled={!canSubmit}
							>
								{isSubmitting ? <Spinner /> : "Send"}
							</Button>
						</div>
					</div>
				</form>
			</Form>
		</div>
	);
}

function relativeDate(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function FeedbackEntryItem({ entry }: { entry: FeedbackEntry }) {
	return (
		<div className="px-3 py-2.5">
			<p className="text-sm text-muted-foreground leading-snug whitespace-pre-wrap break-words">
				{entry.message}
			</p>
			<span className="mt-1 block text-[11px] text-muted-foreground/50">
				{relativeDate(entry.createdAt)}
			</span>
		</div>
	);
}
