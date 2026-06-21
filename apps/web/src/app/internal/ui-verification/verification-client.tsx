"use client";

import { useEffect, useState } from "react";
import { ScrubbableNumberField } from "@/components/ui/number-field";

const cases = [
	{
		label: "Position X",
		initial: 0,
		unit: "px",
		min: -100000,
		max: 100000,
		step: 1,
	},
	{
		label: "Negative position",
		initial: -120,
		unit: "px",
		min: -100000,
		max: 100000,
		step: 1,
	},
	{
		label: "Large position",
		initial: 1920,
		unit: "px",
		min: -100000,
		max: 100000,
		step: 1,
	},
	{ label: "Opacity zero", initial: 0, unit: "%", min: 0, max: 100, step: 1 },
	{
		label: "Opacity full",
		initial: 100,
		unit: "%",
		min: 0,
		max: 100,
		step: 1,
	},
	{ label: "Decimal", initial: 0.25, unit: "", min: 0, max: 10, step: 0.01 },
	{ label: "Scale", initial: 2.5, unit: "", min: 0.01, max: 10, step: 0.01 },
	{ label: "Rotation", initial: -45, unit: "°", min: -360, max: 360, step: 1 },
] as const;

export function NumberFieldVerification() {
	const [values, setValues] = useState<Record<string, string | number>>(
		Object.fromEntries(cases.map((item) => [item.label, item.initial])),
	);
	const [commits, setCommits] = useState(0);
	const [starts, setStarts] = useState(0);
	const [updates, setUpdates] = useState(0);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setHydrated(true));
		return () => cancelAnimationFrame(frame);
	}, []);

	return (
		<main
			className="editor-shell min-h-screen bg-background p-8 text-foreground"
			data-hydrated={hydrated ? "true" : "false"}
		>
			<section className="panel mx-auto max-w-xl p-6">
				<h1 className="text-2xl font-bold">Scrubbable number verification</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Drag the ↔ region or numeric value. Shift is faster; Alt is precise.
				</p>
				<div className="mt-6 grid gap-4">
					{cases.map((item) => (
						<label
							key={item.label}
							className="grid grid-cols-[10rem_1fr] items-center gap-4 text-sm"
						>
							<span className="cursor-ew-resize font-medium">{item.label}</span>
							<ScrubbableNumberField
								icon="↔"
								label={item.label}
								value={values[item.label]}
								min={item.min}
								max={item.max}
								step={item.step}
								unit={item.unit || undefined}
								pixelsPerStep={item.step < 1 ? 10 : 2}
								onChange={(event) => {
									const nextValue = event.currentTarget.value;
									setValues((current) => ({
										...current,
										[item.label]: nextValue,
									}));
								}}
								onBlur={(event) => {
									const rawValue = event.currentTarget.value.trim();
									const parsed = rawValue === "" ? Number.NaN : Number(rawValue);
									const nextValue = Number.isFinite(parsed)
										? parsed
										: item.initial;
									setValues((current) => ({
										...current,
										[item.label]: nextValue,
									}));
								}}
								onScrub={(next) =>
									(setUpdates((current) => current + 1),
									setValues((current) => ({ ...current, [item.label]: next })))
								}
								onScrubStart={() => setStarts((current) => current + 1)}
								onScrubEnd={() => setCommits((current) => current + 1)}
								onScrubCancel={(original) =>
									setValues((current) => ({
										...current,
										[item.label]: original,
									}))
								}
								onReset={() =>
									setValues((current) => ({
										...current,
										[item.label]: item.initial,
									}))
								}
							/>
						</label>
					))}
				</div>
				<p data-testid="commit-count" className="mt-6 text-sm text-muted-foreground">
					Committed gestures: {commits}
				</p>
				<p data-testid="gesture-counts" className="text-sm text-muted-foreground">
					Starts: {starts}; updates: {updates}
				</p>
			</section>
		</main>
	);
}
