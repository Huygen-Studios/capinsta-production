"use client";

import { cn } from "@/utils/ui";
import { clamp } from "@/utils/math";
import { useRef, useState, useLayoutEffect, type ComponentProps } from "react";
import { useFocusLock } from "@/hooks/use-focus-lock";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";

const SUFFIX_GAP_PX = 6;

const DRAG_SENSITIVITIES = {
	default: 1,
	slow: 0.5,
} as const;

type DragSensitivity = "default" | "slow";

type ScrubRange = {
	from: number;
	to: number;
	pixelsPerUnit: number;
};

type ScrubClamp = {
	min?: number;
	max?: number;
};

function clampScrubValue({
	value,
	min,
	max,
}: {
	value: number;
	min?: number;
	max?: number;
}): number {
	if (min != null && max != null) return clamp({ value, min, max });
	if (min != null) return Math.max(min, value);
	if (max != null) return Math.min(max, value);
	return value;
}

function getActiveRange({
	value,
	direction,
	ranges,
}: {
	value: number;
	direction: number;
	ranges: readonly ScrubRange[];
}): ScrubRange | undefined {
	return ranges.find((range) =>
		direction > 0
			? value >= range.from && value < range.to
			: value > range.from && value <= range.to,
	);
}

function scrubAcrossRanges({
	startValue,
	pixelDelta,
	ranges,
	min,
	max,
}: {
	startValue: number;
	pixelDelta: number;
	ranges: readonly ScrubRange[];
	min?: number;
	max?: number;
}): number {
	let currentValue = clampScrubValue({ value: startValue, min, max });
	let remainingPixels = pixelDelta;

	while (remainingPixels !== 0) {
		const direction = Math.sign(remainingPixels);

		const range = getActiveRange({ value: currentValue, direction, ranges });
		if (!range) break;

		const boundary = direction > 0 ? range.to : range.from;
		const pixelsToBoundary =
			Math.abs(boundary - currentValue) * range.pixelsPerUnit;

		if (Math.abs(remainingPixels) <= pixelsToBoundary) {
			currentValue += remainingPixels / range.pixelsPerUnit;
			break;
		}

		currentValue = boundary;
		remainingPixels -= direction * pixelsToBoundary;
	}

	return clampScrubValue({ value: currentValue, min, max });
}

export interface ScrubbableNumberFieldProps
	extends Omit<ComponentProps<"input">, "size" | "type"> {
	icon?: React.ReactNode;
	label?: string;
	suffix?: string;
	unit?: string;
	suffixClassName?: string;
	dragSensitivity?: DragSensitivity;
	pixelsPerStep?: number;
	scrubRanges?: readonly ScrubRange[];
	scrubClamp?: ScrubClamp;
	onScrub?: (value: number) => void;
	onScrubEnd?: () => void;
	onScrubCancel?: (value: number) => void;
	allowExpressions?: boolean;
	onReset?: () => void;
	isDefault?: boolean;
}

export function getScrubModifier(event: Pick<PointerEvent, "shiftKey" | "altKey">) {
	if (event.shiftKey && event.altKey) return 1;
	if (event.shiftKey) return 10;
	if (event.altKey) return 0.1;
	return 1;
}

function ScrubbableNumberField({
	className,
	icon,
	label,
	suffix,
	unit,
	suffixClassName,
	disabled,
	dragSensitivity = "default",
	pixelsPerStep,
	scrubRanges,
	scrubClamp,
	onScrub,
	onScrubEnd,
	onScrubCancel,
	value,
	allowExpressions = true,
	onKeyDown,
	onFocus,
	onBlur,
	onMouseDown,
	onReset,
	isDefault = false,
	ref,
	...props
}: ScrubbableNumberFieldProps & { ref?: React.Ref<HTMLInputElement> }) {
	const iconRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const ghostRef = useRef<HTMLSpanElement>(null);
	const startValueRef = useRef(0);
	const cumulativeDeltaRef = useRef(0);
	const hasDraggedRef = useRef(false);
	const [isInputFocused, setIsInputFocused] = useState(false);
	const [suffixLeft, setSuffixLeft] = useState(0);
	const ghostValue = Array.isArray(value) ? value.join(", ") : String(value ?? "");

	useLayoutEffect(() => {
		if (!suffix) return;
		if (!ghostRef.current || !inputRef.current) return;
		if (ghostRef.current.textContent !== ghostValue) {
			ghostRef.current.textContent = ghostValue;
		}
		const paddingLeft =
			parseFloat(getComputedStyle(inputRef.current).paddingLeft) || 0;
		setSuffixLeft(paddingLeft + ghostRef.current.offsetWidth);
	}, [ghostValue, suffix]);

	const { containerRef: wrapperRef } = useFocusLock<HTMLDivElement>({
		isActive: isInputFocused,
		onDismiss: () => inputRef.current?.blur(),
		cursor: "text",
		allowSelector: "input, textarea, [contenteditable]",
	});

	const handleIconPointerDown = (event: React.PointerEvent) => {
		if (!onScrub || disabled || event.button !== 0) return;
		if (event.pointerType === "touch") {
			inputRef.current?.focus();
			return;
		}
		event.preventDefault();
		const parsed = parseFloat(String(value ?? "0"));
		startValueRef.current = Number.isNaN(parsed) ? 0 : parsed;
		cumulativeDeltaRef.current = 0;
		hasDraggedRef.current = false;
		const startX = event.clientX;
		const pointerId = event.pointerId;
		event.currentTarget.setPointerCapture(pointerId);

		const handlePointerMove = (moveEvent: PointerEvent) => {
			const rawDelta = moveEvent.clientX - startX;
			if (!hasDraggedRef.current && Math.abs(rawDelta) < 3) return;
			hasDraggedRef.current = true;
			cumulativeDeltaRef.current =
				rawDelta * getScrubModifier(moveEvent);
			const sensitivity = pixelsPerStep
				? 1 / pixelsPerStep
				: DRAG_SENSITIVITIES[dragSensitivity];
			const newValue = scrubRanges
				? scrubAcrossRanges({
						startValue: startValueRef.current,
						pixelDelta: cumulativeDeltaRef.current,
						ranges: scrubRanges,
						min: scrubClamp?.min,
						max: scrubClamp?.max,
					})
				: startValueRef.current +
					cumulativeDeltaRef.current * sensitivity;
			onScrub(clampScrubValue({
				value: newValue,
				min: scrubClamp?.min ?? (typeof props.min === "number" ? props.min : undefined),
				max: scrubClamp?.max ?? (typeof props.max === "number" ? props.max : undefined),
			}));
		};

		const finish = (cancelled = false) => {
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("pointerup", handlePointerUp);
			document.removeEventListener("pointercancel", handlePointerCancel);
			if (iconRef.current?.hasPointerCapture(pointerId)) {
				iconRef.current.releasePointerCapture(pointerId);
			}
			if (cancelled) {
				onScrub(startValueRef.current);
				onScrubCancel?.(startValueRef.current);
			} else if (hasDraggedRef.current) {
				onScrubEnd?.();
			} else {
				inputRef.current?.focus();
				inputRef.current?.select();
			}
		};
		const handlePointerUp = () => finish(false);
		const handlePointerCancel = () => finish(true);

		document.addEventListener("pointermove", handlePointerMove);
		document.addEventListener("pointerup", handlePointerUp);
		document.addEventListener("pointercancel", handlePointerCancel);
	};

	const canScrub = Boolean(icon && onScrub);

	const inputNode = (
		<input
			type={allowExpressions ? "text" : "number"}
			inputMode={allowExpressions ? "decimal" : undefined}
			ref={(node) => {
				inputRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			}}
			disabled={disabled}
			value={value}
			role={onScrub ? "spinbutton" : undefined}
			aria-label={label ?? (typeof icon === "string" ? icon : undefined)}
			aria-valuenow={
				onScrub && Number.isFinite(Number(value)) ? Number(value) : undefined
			}
			aria-valuemin={
				typeof props.min === "number" ? props.min : scrubClamp?.min
			}
			aria-valuemax={
				typeof props.max === "number" ? props.max : scrubClamp?.max
			}
			aria-valuetext={
				onScrub && Number.isFinite(Number(value))
					? `${value}${unit ?? suffix ?? ""}`
					: undefined
			}
			className="text-sm leading-none bg-transparent outline-none min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			onMouseDown={(event) => {
				const inputElement = event.currentTarget;
				const shouldPreventNativeCaretPlacement =
					event.button === 0 && document.activeElement !== inputElement;
				if (shouldPreventNativeCaretPlacement) {
					event.preventDefault();
					inputElement.focus();
					inputElement.select();
				}
				onMouseDown?.(event);
			}}
			onFocus={(event) => {
				setIsInputFocused(true);
				const parsed = Number(event.currentTarget.value);
				if (Number.isFinite(parsed)) startValueRef.current = parsed;
				event.currentTarget.select();
				onFocus?.(event);
			}}
			onKeyDown={(event) => {
				if (onScrub && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
					event.preventDefault();
					const direction = event.key === "ArrowUp" ? 1 : -1;
					const step = Number(props.step ?? 1) * (event.shiftKey ? 10 : 1);
					const current = Number(value ?? 0);
					onScrub(
						clampScrubValue({
							value: current + direction * step,
							min: typeof props.min === "number" ? props.min : scrubClamp?.min,
							max: typeof props.max === "number" ? props.max : scrubClamp?.max,
						}),
					);
					onScrubEnd?.();
				}
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					onScrub?.(startValueRef.current);
					onScrubCancel?.(startValueRef.current);
					event.currentTarget.blur();
				}
				onKeyDown?.(event);
			}}
			onBlur={(event) => {
				setIsInputFocused(false);
				onBlur?.(event);
			}}
			{...props}
		/>
	);

	return (
		<div
			ref={wrapperRef}
			className={cn(
				"border-border bg-accent flex h-7 w-full min-w-0 items-center rounded-md border text-sm outline-none cursor-text disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-within:border-primary focus-within:ring-0 focus-within:ring-primary/10 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				disabled && "pointer-events-none cursor-not-allowed opacity-50",
				className,
			)}
		>
			{icon &&
				(canScrub ? (
					<button
						ref={iconRef}
						type="button"
						aria-label="Drag to adjust value"
						disabled={disabled}
						className="text-muted-foreground [&_svg]:size-3.5! shrink-0 select-none pl-2.5 text-sm leading-none cursor-ew-resize"
						onMouseDown={(event) => event.preventDefault()}
						onPointerDown={handleIconPointerDown}
						onDoubleClick={() => onReset?.()}
						title="Drag horizontally to adjust. Shift is faster; Alt is more precise."
					>
						{icon}
					</button>
				) : (
					<span className="text-muted-foreground [&_svg]:size-3.5! shrink-0 select-none pl-2.5 text-sm leading-none">
						{icon}
					</span>
				))}
			<span
				className={cn(
					"relative flex flex-1 min-w-0 items-center",
					icon ? "px-1.5" : "pl-2.5",
					onReset ? "pr-0" : "pr-2.5",
				)}
			>
				{inputNode}
				{suffix && (
					<>
						{/* Ghost mirrors value text to measure width for suffix positioning */}
						<span
							ref={ghostRef}
							className="invisible absolute text-sm leading-none whitespace-pre pointer-events-none"
							aria-hidden="true"
						>
							{ghostValue}
						</span>
						<span
							className={cn(
								"absolute top-1/2 -translate-y-1/2 select-none pointer-events-none text-sm leading-none",
								suffixClassName,
							)}
							style={{ left: suffixLeft + SUFFIX_GAP_PX }}
						>
							{suffix}
						</span>
					</>
				)}
			</span>
			{onReset && !isDefault && (
				<div className="shrink-0 pr-2 flex items-center">
					<Button
						variant="text"
						size="text"
						aria-label="Reset to default"
						onClick={onReset}
					>
						<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5!" />
					</Button>
				</div>
			)}
		</div>
	);
}

const NumberField = ScrubbableNumberField;

export { NumberField, ScrubbableNumberField };
