"use client";

import type {
	NumberParamDefinition,
	ParamDefinition,
	ParamValue,
} from "@/params";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { SectionField } from "@/components/section";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePropertyDraft } from "../hooks/use-property-draft";
import { KeyframeToggle } from "./keyframe-toggle";

export function PropertyParamField({
	param,
	value,
	onPreview,
	onCommit,
	keyframe,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe?: {
		isActive: boolean;
		isDisabled: boolean;
		onToggle: () => void;
	};
}) {
	return (
		<SectionField
			label={param.label}
			beforeLabel={
				keyframe && param.keyframable !== false ? (
					<KeyframeToggle
						isActive={keyframe.isActive}
						isDisabled={keyframe.isDisabled}
						title={`Toggle ${param.label.toLowerCase()} keyframe`}
						onToggle={keyframe.onToggle}
					/>
				) : undefined
			}
		>
			<ParamInput
				param={param}
				value={value}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		</SectionField>
	);
}

function ParamInput({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	if (param.type === "number") {
		const numericValue = typeof value === "number" ? value : Number(value);
		return (
			<NumberParamField
				param={param}
				value={Number.isFinite(numericValue) ? numericValue : param.default}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
	}

	if (param.type === "boolean") {
		return (
			<Switch
				checked={Boolean(value)}
				onCheckedChange={(checked) => {
					onPreview(checked);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "select") {
		return (
			<Select
				value={String(value)}
				onValueChange={(selected) => {
					onPreview(selected);
					onCommit();
				}}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{param.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	if (param.type === "color") {
		return (
			<ColorPicker
				value={String(value).replace(/^#/, "").toUpperCase()}
				onChange={(color) => onPreview(`#${color}`)}
				onChangeEnd={(color) => {
					onPreview(`#${color}`);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "text") {
		return (
			<Textarea
				value={String(value)}
				onChange={(event) => onPreview(event.currentTarget.value)}
				onBlur={onCommit}
			/>
		);
	}

	if (param.type === "font") {
		return (
			<input
				className="border-input bg-accent h-9 w-full rounded-md border px-3 text-sm outline-none"
				value={String(value)}
				onChange={(event) => onPreview(event.currentTarget.value)}
				onBlur={onCommit}
			/>
		);
	}

	return null;
}

function NumberParamField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const normalizedLabel = param.label.toLowerCase();
	const normalizedKey = param.key.toLowerCase();
	const inferredPercent =
		param.unit === "percent" || normalizedKey.includes("opacity");
	const displayMultiplier =
		param.displayMultiplier ?? (inferredPercent ? 100 : 1);
	const explicitDisplaySpace = param.displayMultiplier != null;
	const displayMin = explicitDisplaySpace
		? param.min
		: param.min * displayMultiplier;
	const displayMax =
		param.max == null
			? undefined
			: explicitDisplaySpace
				? param.max
				: param.max * displayMultiplier;
	const displayStep = explicitDisplaySpace
		? param.step
		: param.step * displayMultiplier;
	const displayValue = value * displayMultiplier;

	const clampDisplayValue = (nextDisplayValue: number) =>
		Math.max(
			displayMin,
			displayMax !== undefined
				? Math.min(displayMax, nextDisplayValue)
				: nextDisplayValue,
		);

	const previewFromDisplay = (displayVal: number) => {
		if (!Number.isFinite(displayVal)) return;
		const clamped = clampDisplayValue(
			snapToStep({ value: displayVal, step: displayStep }),
		);
		onPreview(clamped / displayMultiplier);
	};

	const maxFractionDigits = getFractionDigitsForStep({ step: displayStep });
	const draft = usePropertyDraft({
		displayValue: formatNumberForDisplay({
			value: displayValue,
			maxFractionDigits,
		}),
		parse: (input) => {
			if (input.trim() === "") return null;
			const parsed = Number(input);
			if (!Number.isFinite(parsed)) return null;
			return clampDisplayValue(
				snapToStep({ value: parsed, step: displayStep }),
			);
		},
		onPreview: previewFromDisplay,
		onCommit,
	});

	const handleReset = () => {
		onPreview(param.default);
		onCommit();
	};

	const usesPixels =
		normalizedKey.includes("position") ||
		normalizedLabel.includes("position") ||
		normalizedLabel.includes("size") ||
		normalizedLabel.includes("width") ||
		normalizedLabel.includes("height") ||
		normalizedLabel.includes("blur") ||
		normalizedLabel.includes("radius") ||
		normalizedLabel.includes("spacing") ||
		normalizedLabel.includes("padding");
	const resolvedUnit =
		normalizedKey.includes("rotate") || normalizedLabel.includes("rotation")
			? "°"
			: inferredPercent
				? "%"
				: usesPixels
					? "px"
					: undefined;

	return (
		<NumberField
			icon={param.shortLabel ?? "↔"}
			label={param.label}
			value={draft.displayValue}
			min={displayMin}
			max={displayMax}
			step={displayStep}
			unit={resolvedUnit}
			pixelsPerStep={displayStep < 1 ? 12 : 2}
			dragSensitivity="slow"
			isDefault={value === param.default}
			onFocus={draft.onFocus}
			onChange={draft.onChange}
			onBlur={draft.onBlur}
			onScrub={previewFromDisplay}
			onScrubEnd={onCommit}
			onReset={handleReset}
		/>
	);
}
