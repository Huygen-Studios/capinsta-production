"use client";

import { useEffect, useRef, useState } from "react";
import {
	PRIVATE_SERVER_CONTACT_METHOD_OPTIONS,
	PRIVATE_SERVER_USE_CASE_OPTIONS,
	PRIVATE_SERVER_WORKLOAD_OPTIONS,
	type PrivateServerRequestInput,
} from "@/private-server/request";

type RequestState = "idle" | "submitting" | "success" | "error";
type PrivateServerRequestFormState = Omit<
	PrivateServerRequestInput,
	"consentToContact"
> & {
	consentToContact: boolean;
};

const emptyForm: PrivateServerRequestFormState = {
	fullName: "",
	email: "",
	companyName: "",
	phone: "",
	website: "",
	teamSize: "",
	monthlyWorkload: "Not sure yet",
	primaryUseCase: "Caption processing",
	currentPlanOrUsage: "",
	preferredContactMethod: "Email",
	preferredContactTime: "",
	technicalRequirements: "",
	message: "",
	consentToContact: false,
	websiteConfirmation: "",
};

function fieldValue({
	form,
	key,
}: {
	form: PrivateServerRequestFormState;
	key: keyof PrivateServerRequestFormState;
}) {
	const value = form[key];
	return typeof value === "string" ? value : "";
}

export function PrivateServerRequestButton() {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<RequestState>("idle");
	const [form, setForm] = useState<PrivateServerRequestFormState>(emptyForm);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [message, setMessage] = useState<string | null>(null);
	const firstInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) firstInputRef.current?.focus();
	}, [open]);

	const setText = (key: keyof PrivateServerRequestFormState) => (
		event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
	) => {
		setForm((current) => ({ ...current, [key]: event.target.value }));
		setErrors((current) => ({ ...current, [key]: "" }));
	};

	const submit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (state === "submitting") return;
		setState("submitting");
		setErrors({});
		setMessage("Sending request...");
		try {
			const response = await fetch("/api/private-server/request", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(form),
			});
			const payload: unknown = await response.json().catch(() => ({}));
			if (!response.ok) {
				const fieldErrors =
					payload && typeof payload === "object" && "details" in payload
						? Reflect.get(payload, "details")
						: null;
				if (fieldErrors && typeof fieldErrors === "object") {
					setErrors(
						Object.fromEntries(
							Object.entries(fieldErrors).map(([key, value]) => [
								key,
								Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""),
							]),
						),
					);
				}
				throw new Error("We could not submit your request. Please try again later.");
			}
			setState("success");
			setMessage(
				"Thanks - your Private Server request has been received. Our team will review your requirements and contact you shortly.",
			);
		} catch (error) {
			setState("error");
			setMessage(error instanceof Error ? error.message : "We could not submit your request. Please try again later.");
		}
	};

	return (
		<div className="space-y-2">
			<button
				type="button"
				className="flex h-11 w-full items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)]"
				onClick={() => {
					setOpen(true);
					setState("idle");
					setMessage(null);
				}}
			>
				Talk to Team
			</button>
			{open ? (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8"
					role="dialog"
					aria-modal="true"
					aria-labelledby="private-server-request-title"
				>
					<div className="cap-brutal-card w-full max-w-3xl bg-card p-5 sm:p-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 id="private-server-request-title" className="text-2xl font-black">
									Request Private Server
								</h2>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									Talk to our team to confirm workload requirements, availability, and onboarding.
								</p>
							</div>
							<button
								type="button"
								className="rounded-sm border-2 border-border px-3 py-1 text-sm font-black"
								onClick={() => setOpen(false)}
							>
								Close
							</button>
						</div>
						<form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
							<input
								type="text"
								name="websiteConfirmation"
								value={fieldValue({ form, key: "websiteConfirmation" })}
								onChange={setText("websiteConfirmation")}
								className="hidden"
								tabIndex={-1}
								autoComplete="off"
								aria-hidden="true"
							/>
							<label className="grid gap-2 text-sm font-bold">
								Full name
								<input ref={firstInputRef} className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "fullName" })} onChange={setText("fullName")} required />
								{errors.fullName ? <span className="text-xs text-destructive">{errors.fullName}</span> : null}
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Work email
								<input type="email" className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "email" })} onChange={setText("email")} required />
								{errors.email ? <span className="text-xs text-destructive">{errors.email}</span> : null}
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Company / organization
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "companyName" })} onChange={setText("companyName")} required />
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Phone / WhatsApp
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "phone" })} onChange={setText("phone")} />
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Estimated monthly workload
								<select className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "monthlyWorkload" })} onChange={setText("monthlyWorkload")} required>
									{PRIVATE_SERVER_WORKLOAD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
								</select>
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Primary use case
								<select className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "primaryUseCase" })} onChange={setText("primaryUseCase")} required>
									{PRIVATE_SERVER_USE_CASE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
								</select>
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Website
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "website" })} onChange={setText("website")} />
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Team size
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "teamSize" })} onChange={setText("teamSize")} />
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Current plan or usage
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "currentPlanOrUsage" })} onChange={setText("currentPlanOrUsage")} />
							</label>
							<label className="grid gap-2 text-sm font-bold">
								Preferred contact method
								<select className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "preferredContactMethod" })} onChange={setText("preferredContactMethod")}>
									{PRIVATE_SERVER_CONTACT_METHOD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
								</select>
							</label>
							<label className="grid gap-2 text-sm font-bold sm:col-span-2">
								Preferred contact time
								<input className="rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "preferredContactTime" })} onChange={setText("preferredContactTime")} />
							</label>
							<label className="grid gap-2 text-sm font-bold sm:col-span-2">
								Additional technical requirements
								<textarea className="min-h-24 rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "technicalRequirements" })} onChange={setText("technicalRequirements")} />
							</label>
							<label className="grid gap-2 text-sm font-bold sm:col-span-2">
								Message / requirements
								<textarea className="min-h-28 rounded-sm border-2 border-border bg-background px-3 py-2" value={fieldValue({ form, key: "message" })} onChange={setText("message")} required />
								{errors.message ? <span className="text-xs text-destructive">{errors.message}</span> : null}
							</label>
							<label className="flex items-start gap-3 text-sm font-bold sm:col-span-2">
								<input
									type="checkbox"
									className="mt-1 size-4"
									checked={Boolean(form.consentToContact)}
									onChange={(event) => {
										setForm((current) => ({ ...current, consentToContact: event.target.checked }));
										setErrors((current) => ({ ...current, consentToContact: "" }));
									}}
									required
								/>
								I agree to be contacted about this Private Server request.
							</label>
							{errors.consentToContact ? <p className="text-xs text-destructive sm:col-span-2">{errors.consentToContact}</p> : null}
							<div className="space-y-2 sm:col-span-2">
								<button
									type="submit"
									className="flex h-11 w-full items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] disabled:opacity-60"
									disabled={state === "submitting" || state === "success"}
								>
									{state === "submitting" ? "Sending request..." : state === "success" ? "Request received" : state === "error" ? "Try again" : "Send Request"}
								</button>
								{message ? (
									<p className="text-sm leading-6 text-muted-foreground" role={state === "error" ? "alert" : "status"} aria-live="polite">
										{message}
									</p>
								) : null}
							</div>
						</form>
					</div>
				</div>
			) : null}
		</div>
	);
}
