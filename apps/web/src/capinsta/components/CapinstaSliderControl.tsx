"use client";

import { useId } from "react";
import { ScrubbableNumberField } from "@/components/ui/number-field";

export function CapinstaSliderControl({
	label,
	value,
	min,
	max,
	step = 1,
	unit = "",
	mixed = false,
	scrubbable = true,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	unit?: string;
	mixed?: boolean;
	scrubbable?: boolean;
	onChange: (value: number) => void;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	return (
		<div className="grid gap-1 text-xs">
			<div className="flex items-center justify-between gap-3">
				<span id={labelId} className="text-muted-foreground">
					{label}
				</span>
				{scrubbable ? (
					<ScrubbableNumberField
						className="h-7 w-28"
						icon="↔"
						label={label}
						value={mixed ? "Mixed" : Number.isInteger(value) ? value : value.toFixed(2)}
						min={min}
						max={max}
						step={step}
						suffix={mixed ? undefined : unit}
						unit={unit}
						allowExpressions={false}
						pixelsPerStep={step < 1 ? 10 : 2}
						onScrub={onChange}
						onChange={(event) => {
							const next = Number(event.currentTarget.value);
							if (Number.isFinite(next)) onChange(next);
						}}
					/>
				) : (
					<span className="font-mono">
						{mixed
							? "Mixed"
							: `${Number.isInteger(value) ? value : value.toFixed(2)}${unit}`}
					</span>
				)}
			</div>
			<input
				id={id}
				type="range"
				value={value}
				min={min}
				max={max}
				step={step}
				aria-labelledby={labelId}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
				className="w-full"
			/>
		</div>
	);
}
