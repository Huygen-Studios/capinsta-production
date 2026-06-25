"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BoxSelectionSnapshot,
	ResolveIntersections,
	SelectionBoxBounds,
} from "@/selection/types";

interface SelectionBoxState<TId> extends BoxSelectionSnapshot<TId> {
	startPos: { x: number; y: number };
	currentPos: { x: number; y: number };
	startContentPos: { x: number; y: number } | null;
	bounds: SelectionBoxBounds | null;
	isActive: boolean;
	isAdditive: boolean;
}

function getSelectionBoxBounds({
	container,
	scrollContainer,
	startPos,
	currentPos,
	startContentPos,
}: {
	container: HTMLElement;
	scrollContainer?: HTMLElement | null;
	startPos: { x: number; y: number };
	currentPos: { x: number; y: number };
	startContentPos?: { x: number; y: number } | null;
}): SelectionBoxBounds {
	const containerRect = container.getBoundingClientRect();
	const scrollRect = scrollContainer?.getBoundingClientRect() ?? containerRect;
	const scrollLeft = scrollContainer?.scrollLeft ?? 0;
	const scrollTop = scrollContainer?.scrollTop ?? 0;
	const startX = startContentPos
		? startContentPos.x - scrollLeft + scrollRect.left - containerRect.left
		: startPos.x - containerRect.left;
	const startY = startContentPos
		? startContentPos.y - scrollTop + scrollRect.top - containerRect.top
		: startPos.y - containerRect.top;
	const currentX = currentPos.x - containerRect.left;
	const currentY = currentPos.y - containerRect.top;

	return {
		left: Math.min(startX, currentX),
		top: Math.min(startY, currentY),
		width: Math.abs(currentX - startX),
		height: Math.abs(currentY - startY),
	};
}

export function useBoxSelect<TId>({
	containerRef,
	scrollContainerRef,
	resolveIntersections,
	selectedIds,
	anchorId,
	onSelectionChange,
	shouldStartSelection,
	getIsAdditiveSelection,
	isEnabled = true,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	scrollContainerRef?: React.RefObject<HTMLElement | null>;
	resolveIntersections: ResolveIntersections<TId>;
	selectedIds: TId[];
	anchorId: TId | null;
	onSelectionChange: (state: {
		intersectedIds: TId[];
		initialSelectedIds: TId[];
		initialAnchorId: TId | null;
		isAdditive: boolean;
	}) => void;
	shouldStartSelection?: (event: React.MouseEvent<Element>) => boolean;
	getIsAdditiveSelection?: (event: React.MouseEvent<Element>) => boolean;
	isEnabled?: boolean;
}) {
	const [selectionBox, setSelectionBox] =
		useState<SelectionBoxState<TId> | null>(null);
	const justFinishedSelectingRef = useRef(false);

	const getContentPos = useCallback(
		(pos: { x: number; y: number }) => {
			const container = containerRef.current;
			const scrollContainer = scrollContainerRef?.current ?? null;
			const containerRect = container?.getBoundingClientRect();
			const scrollRect = scrollContainer?.getBoundingClientRect() ?? containerRect;
			if (!container || !containerRect || !scrollRect) return null;

			return {
				x: pos.x - scrollRect.left + (scrollContainer?.scrollLeft ?? 0),
				y: pos.y - scrollRect.top + (scrollContainer?.scrollTop ?? 0),
			};
		},
		[containerRef, scrollContainerRef],
	);

	const handleMouseDown = useCallback(
		(event: React.MouseEvent<Element>) => {
			const canStartSelection = shouldStartSelection
				? shouldStartSelection(event)
				: true;
			if (!isEnabled || event.button !== 0 || !canStartSelection) {
				return;
			}

			const startPos = { x: event.clientX, y: event.clientY };
			const container = containerRef.current;
			const scrollContainer = scrollContainerRef?.current ?? null;
			const startContentPos = getContentPos(startPos);
			setSelectionBox({
				startPos,
				currentPos: startPos,
				startContentPos,
				bounds: container
					? getSelectionBoxBounds({
							container,
							scrollContainer,
							startPos,
							currentPos: startPos,
							startContentPos,
						})
					: null,
				isActive: false,
				isAdditive: getIsAdditiveSelection
					? getIsAdditiveSelection(event)
					: event.ctrlKey || event.metaKey,
				initialSelectedIds: selectedIds,
				initialAnchorId: anchorId,
			});
		},
		[
			anchorId,
			containerRef,
			scrollContainerRef,
			getContentPos,
			getIsAdditiveSelection,
			isEnabled,
			selectedIds,
			shouldStartSelection,
		],
	);

	const updateSelection = useCallback(
		({
			startPos,
			currentPos,
			startContentPos,
			isAdditive,
			initialSelectedIds,
			initialAnchorId,
		}: SelectionBoxState<TId>) => {
			const intersectedIds = resolveIntersections({
				startPos,
				currentPos,
				startContentPos,
				currentContentPos: getContentPos(currentPos),
			});
			onSelectionChange({
				intersectedIds,
				initialSelectedIds,
				initialAnchorId,
				isAdditive,
			});
		},
		[getContentPos, onSelectionChange, resolveIntersections],
	);

	useEffect(() => {
		if (!selectionBox) {
			return;
		}

		const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
			const currentPos = { x: clientX, y: clientY };
			const deltaX = Math.abs(clientX - selectionBox.startPos.x);
			const deltaY = Math.abs(clientY - selectionBox.startPos.y);
			const container = containerRef.current;
			const scrollContainer = scrollContainerRef?.current ?? null;
			const nextSelectionBox = {
				...selectionBox,
				currentPos,
				bounds: container
					? getSelectionBoxBounds({
							container,
							scrollContainer,
							startPos: selectionBox.startPos,
							currentPos,
							startContentPos: selectionBox.startContentPos,
						})
					: null,
				isActive: deltaX > 5 || deltaY > 5 || selectionBox.isActive,
			};

			setSelectionBox(nextSelectionBox);

			if (!nextSelectionBox.isActive) {
				return;
			}

			updateSelection(nextSelectionBox);
		};

		const handleMouseUp = () => {
			if (selectionBox.isActive) {
				justFinishedSelectingRef.current = true;
				requestAnimationFrame(() => {
					justFinishedSelectingRef.current = false;
				});
			}

			setSelectionBox(null);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [containerRef, scrollContainerRef, selectionBox, updateSelection]);

	useEffect(() => {
		if (!selectionBox?.isActive) return;
		const scrollContainer = scrollContainerRef?.current;
		const container = containerRef.current;
		if (!scrollContainer || !container) return;

		const handleScroll = () => {
			setSelectionBox((current) => {
				if (!current?.isActive) return current;
				const next = {
					...current,
					bounds: getSelectionBoxBounds({
						container,
						scrollContainer,
						startPos: current.startPos,
						currentPos: current.currentPos,
						startContentPos: current.startContentPos,
					}),
				};
				updateSelection(next);
				return next;
			});
		};

		scrollContainer.addEventListener("scroll", handleScroll);
		return () => scrollContainer.removeEventListener("scroll", handleScroll);
	}, [containerRef, scrollContainerRef, selectionBox?.isActive, updateSelection]);

	useEffect(() => {
		if (!selectionBox) {
			return;
		}

		const container = containerRef.current;
		const previousBodyUserSelect = document.body.style.userSelect;
		const previousContainerUserSelect = container?.style.userSelect ?? "";

		document.body.style.userSelect = "none";
		if (container) {
			container.style.userSelect = "none";
		}

		return () => {
			document.body.style.userSelect = previousBodyUserSelect;
			if (container) {
				container.style.userSelect = previousContainerUserSelect;
			}
		};
	}, [containerRef, selectionBox]);

	const shouldIgnoreClick = useCallback(() => {
		return justFinishedSelectingRef.current;
	}, []);

	return {
		selectionBox:
			selectionBox?.isActive && selectionBox.bounds
				? { bounds: selectionBox.bounds }
				: null,
		currentPos: selectionBox?.currentPos ?? null,
		handleMouseDown,
		isSelecting: selectionBox?.isActive ?? false,
		shouldIgnoreClick,
	};
}
