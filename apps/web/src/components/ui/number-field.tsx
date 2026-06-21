"use client";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { clamp } from "@/utils/math";

const DRAG_THRESHOLD_PX = 4;

type DragSensitivity = "default" | "slow";
type ScrubRange = { from: number; to: number; pixelsPerUnit: number };
type ScrubClamp = { min?: number; max?: number };

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
	onScrubStart?: (value: number) => void;
	onScrubEnd?: () => void;
	onScrubCancel?: (value: number) => void;
	allowExpressions?: boolean;
	onReset?: () => void;
	isDefault?: boolean;
}

function finiteNumber(value: unknown): number | null {
	if (value === "" || value == null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function clampScrubValue({
	value,
	min,
	max,
}: {
	value: number;
	min?: number;
	max?: number;
}) {
	if (min != null && max != null) return clamp({ value, min, max });
	if (min != null) return Math.max(min, value);
	if (max != null) return Math.min(max, value);
	return value;
}

function snapToStep({
	value,
	step,
	origin = 0,
}: {
	value: number;
	step: number;
	origin?: number;
}) {
	if (!Number.isFinite(step) || step <= 0) return value;
	const exponent = step.toString().toLowerCase().split("e-")[1];
	const decimals = exponent
		? Number(exponent)
		: (step.toString().split(".")[1]?.length ?? 0);
	const snapped = origin + Math.round((value - origin) / step) * step;
	return Number(snapped.toFixed(Math.min(decimals, 12)));
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
}) {
	let currentValue = clampScrubValue({ value: startValue, min, max });
	let remainingPixels = pixelDelta;

	while (remainingPixels !== 0) {
		const direction = Math.sign(remainingPixels);
		const range = ranges.find((candidate) =>
			direction > 0
				? currentValue >= candidate.from && currentValue < candidate.to
				: currentValue > candidate.from && currentValue <= candidate.to,
		);
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

export function getScrubModifier(
	event: Pick<PointerEvent, "shiftKey" | "altKey">,
) {
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
	onScrubStart,
	onScrubEnd,
	onScrubCancel,
	value,
	allowExpressions = true,
	onKeyDown,
	onFocus,
	onBlur,
	onMouseDown,
	onPointerDown,
	onReset,
	isDefault = false,
	ref,
	min,
	max,
	step,
	...props
}: ScrubbableNumberFieldProps & { ref?: React.Ref<HTMLInputElement> }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const activeTargetRef = useRef<HTMLElement | null>(null);
	const pointerIdRef = useRef<number | null>(null);
	const startXRef = useRef(0);
	const startValueRef = useRef(0);
	const draggedRef = useRef(false);
	const windowMoveRef = useRef<((event: PointerEvent) => void) | null>(null);
	const windowUpRef = useRef<((event: PointerEvent) => void) | null>(null);
	const windowCancelRef = useRef<((event: PointerEvent) => void) | null>(null);
	const [isScrubbing, setIsScrubbing] = useState(false);
	const [scrubDisplayValue, setScrubDisplayValue] = useState<number | null>(null);

	const numericMin =
		typeof min === "number" ? min : scrubClamp?.min;
	const numericMax =
		typeof max === "number" ? max : scrubClamp?.max;
	const numericStep = Number(step ?? 1);

	const restoreGlobalInteraction = useCallback(() => {
		document.documentElement.style.cursor = "";
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		setIsScrubbing(false);
	}, []);

	const releasePointer = useCallback(() => {
		if (windowMoveRef.current) {
			window.removeEventListener("pointermove", windowMoveRef.current);
		}
		if (windowUpRef.current) {
			window.removeEventListener("pointerup", windowUpRef.current);
		}
		if (windowCancelRef.current) {
			window.removeEventListener("pointercancel", windowCancelRef.current);
		}
		windowMoveRef.current = null;
		windowUpRef.current = null;
		windowCancelRef.current = null;
		const target = activeTargetRef.current;
		const pointerId = pointerIdRef.current;
		if (target && pointerId != null && target.hasPointerCapture(pointerId)) {
			target.releasePointerCapture(pointerId);
		}
		activeTargetRef.current = null;
		pointerIdRef.current = null;
		restoreGlobalInteraction();
	}, [restoreGlobalInteraction]);

	const cancelScrub = useCallback(() => {
		if (!draggedRef.current) {
			releasePointer();
			return;
		}
		onScrub?.(startValueRef.current);
		onScrubCancel?.(startValueRef.current);
		setScrubDisplayValue(null);
		draggedRef.current = false;
		releasePointer();
	}, [onScrub, onScrubCancel, releasePointer]);

	useEffect(
		() => () => {
			if (windowMoveRef.current) {
				window.removeEventListener("pointermove", windowMoveRef.current);
			}
			if (windowUpRef.current) {
				window.removeEventListener("pointerup", windowUpRef.current);
			}
			if (windowCancelRef.current) {
				window.removeEventListener("pointercancel", windowCancelRef.current);
			}
			const target = activeTargetRef.current;
			const pointerId = pointerIdRef.current;
			if (target && pointerId != null && target.hasPointerCapture(pointerId)) {
				target.releasePointerCapture(pointerId);
			}
			document.documentElement.style.cursor = "";
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		},
		[],
	);

	useEffect(() => {
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && isScrubbing) {
				event.preventDefault();
				cancelScrub();
			}
		};
		window.addEventListener("keydown", handleEscape);
		return () => window.removeEventListener("keydown", handleEscape);
	}, [cancelScrub, isScrubbing]);

	const beginScrub = (event: ReactPointerEvent<HTMLElement>) => {
		if (!onScrub || disabled || (event.buttons & 1) !== 1) return;
		if (event.pointerType === "touch") return;

		const parsed = finiteNumber(value);
		startValueRef.current = parsed ?? 0;
		startXRef.current = event.clientX;
		draggedRef.current = false;
		activeTargetRef.current = event.currentTarget;
		pointerIdRef.current = event.pointerId;
		onScrubStart?.(startValueRef.current);

		const handleWindowMove = (pointerEvent: PointerEvent) => {
			if (
				!onScrub ||
				pointerEvent.pointerId !== pointerIdRef.current ||
				!activeTargetRef.current
			) {
				return;
			}
			const rawDelta = pointerEvent.clientX - startXRef.current;
			if (!draggedRef.current && Math.abs(rawDelta) < DRAG_THRESHOLD_PX) {
				return;
			}

			if (!draggedRef.current) {
				draggedRef.current = true;
				setIsScrubbing(true);
				document.documentElement.style.cursor = "ew-resize";
				document.body.style.cursor = "ew-resize";
				document.body.style.userSelect = "none";
				inputRef.current?.blur();
			}

			pointerEvent.preventDefault();
			const modifiedDelta = rawDelta * getScrubModifier(pointerEvent);
			const sensitivity =
				pixelsPerStep != null
					? numericStep / pixelsPerStep
					: dragSensitivity === "slow"
						? 0.5
						: 1;
			const unsnappedValue = scrubRanges
				? scrubAcrossRanges({
						startValue: startValueRef.current,
						pixelDelta: modifiedDelta,
						ranges: scrubRanges,
						min: numericMin,
						max: numericMax,
					})
				: clampScrubValue({
						value: startValueRef.current + modifiedDelta * sensitivity,
						min: numericMin,
						max: numericMax,
					});
			const nextValue = scrubRanges
				? unsnappedValue
				: clampScrubValue({
						value: snapToStep({
							value: unsnappedValue,
							step: numericStep,
							origin: numericMin ?? 0,
						}),
						min: numericMin,
						max: numericMax,
					});
			if (Number.isFinite(nextValue)) {
				setScrubDisplayValue(nextValue);
				onScrub(nextValue);
			}
		};

		const handleWindowUp = (pointerEvent: PointerEvent) => {
			if (pointerEvent.pointerId !== pointerIdRef.current) return;
			const dragged = draggedRef.current;
			draggedRef.current = false;
			releasePointer();
			if (dragged) {
				onScrubEnd?.();
				requestAnimationFrame(() => setScrubDisplayValue(null));
			} else {
				requestAnimationFrame(() => {
					inputRef.current?.focus();
					inputRef.current?.select();
				});
			}
		};

		const handleWindowCancel = (pointerEvent: PointerEvent) => {
			if (pointerEvent.pointerId === pointerIdRef.current) cancelScrub();
		};

		windowMoveRef.current = handleWindowMove;
		windowUpRef.current = handleWindowUp;
		windowCancelRef.current = handleWindowCancel;
		window.addEventListener("pointermove", handleWindowMove, {
			passive: false,
		});
		window.addEventListener("pointerup", handleWindowUp);
		window.addEventListener("pointercancel", handleWindowCancel);
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Window listeners preserve the interaction if capture is unavailable.
		}
	};

	const scrubHandlers = {
		onPointerDown: beginScrub,
	};

	const unitText = unit ?? suffix;
	const renderedValue =
		isScrubbing && scrubDisplayValue != null ? scrubDisplayValue : value;
	const currentNumericValue = finiteNumber(renderedValue);

	return (
		<div
			className={cn(
				"scrubbable-number-field flex h-8 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-border bg-input text-sm transition-colors",
				"focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15",
				isScrubbing && "border-primary bg-primary/10 ring-2 ring-primary/20",
				disabled && "pointer-events-none opacity-50",
				className,
			)}
			data-scrubbing={isScrubbing ? "true" : "false"}
		>
			{icon && (
				<button
					type="button"
					disabled={disabled}
					aria-label={`Scrub ${label ?? "value"}`}
					title="Drag horizontally to adjust. Shift is faster; Alt is more precise."
					className="scrubbable-number-field__handle grid min-w-8 shrink-0 cursor-ew-resize select-none place-items-center border-r border-border px-2 text-xs font-semibold text-muted-foreground hover:bg-primary/10 hover:text-primary"
					onDoubleClick={onReset}
					{...scrubHandlers}
				>
					{icon}
				</button>
			)}

			<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-stretch">
				<input
					type={allowExpressions ? "text" : "number"}
					inputMode="decimal"
					ref={(node) => {
						inputRef.current = node;
						if (typeof ref === "function") ref(node);
						else if (ref) ref.current = node;
					}}
					disabled={disabled}
					value={renderedValue ?? ""}
					min={min}
					max={max}
					step={step}
					role={onScrub ? "spinbutton" : undefined}
					aria-label={label ?? (typeof icon === "string" ? icon : undefined)}
					aria-valuenow={currentNumericValue ?? undefined}
					aria-valuemin={numericMin}
					aria-valuemax={numericMax}
					aria-valuetext={
						currentNumericValue == null
							? undefined
							: `${currentNumericValue}${unitText ? ` ${unitText}` : ""}`
					}
					className="scrubbable-number-field__input min-w-0 cursor-ew-resize bg-transparent px-2.5 text-sm tabular-nums leading-none text-foreground outline-none [appearance:textfield] selection:bg-primary/30 focus:cursor-text [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
					onMouseDown={(event) => {
						onMouseDown?.(event);
					}}
					onFocus={(event) => {
						const parsed = finiteNumber(event.currentTarget.value);
						if (parsed != null) startValueRef.current = parsed;
						event.currentTarget.select();
						onFocus?.(event);
					}}
					onKeyDown={(event) => {
						if (
							onScrub &&
							(event.key === "ArrowUp" || event.key === "ArrowDown")
						) {
							event.preventDefault();
							const direction = event.key === "ArrowUp" ? 1 : -1;
							const keyboardStep = numericStep * (event.shiftKey ? 10 : 1);
							const current = finiteNumber(value) ?? startValueRef.current;
							const next = clampScrubValue({
								value: snapToStep({
									value: current + direction * keyboardStep,
									step: numericStep,
									origin: numericMin ?? 0,
								}),
								min: numericMin,
								max: numericMax,
							});
							if (Number.isFinite(next)) {
								onScrub(next);
								onScrubEnd?.();
							}
						}
						if (event.key === "Enter") event.currentTarget.blur();
						if (event.key === "Escape") {
							event.preventDefault();
							onScrub?.(startValueRef.current);
							onScrubCancel?.(startValueRef.current);
							event.currentTarget.blur();
						}
						onKeyDown?.(event);
					}}
					onBlur={onBlur}
					onPointerDown={(event) => {
						onPointerDown?.(event);
						beginScrub(event);
					}}
					{...props}
				/>
				{unitText && (
					<span
						aria-hidden="true"
						className={cn(
							"scrubbable-number-field__unit grid min-w-8 shrink-0 select-none place-items-center border-l border-border bg-accent/60 px-2 text-xs tabular-nums text-muted-foreground",
							suffixClassName,
						)}
					>
						{unitText}
					</span>
				)}
			</div>

			{onReset && !isDefault && (
				<div className="grid shrink-0 place-items-center border-l border-border px-1">
					<Button
						variant="text"
						size="text"
						aria-label={`Reset ${label ?? "value"} to default`}
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
