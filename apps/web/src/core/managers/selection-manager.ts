import type { EditorCore } from "@/core";
import type { SelectedKeyframeRef } from "@/animation/types";
import type {
	ElementSelectionMode,
	EditorSelectionKind,
	EditorSelectionPatch,
	EditorSelectionSnapshot,
	SelectedMaskPointSelection,
} from "@/selection/editor-selection";
import type { ElementRef } from "@/timeline/types";

export class SelectionManager {
	private selectedElements: ElementRef[] = [];
	private elementSelectionMode: ElementSelectionMode = "individual";
	private primarySelectedElement: ElementRef | null = null;
	private selectedKeyframes: SelectedKeyframeRef[] = [];
	private keyframeSelectionAnchor: SelectedKeyframeRef | null = null;
	private selectedMaskPoints: SelectedMaskPointSelection | null = null;
	private listeners = new Set<() => void>();

	constructor(editor: EditorCore) {
		void editor;
	}

	getSelectedElements(): ElementRef[] {
		return this.selectedElements;
	}

	getElementSelectionMode(): ElementSelectionMode {
		return this.elementSelectionMode;
	}

	getPrimarySelectedElement(): ElementRef | null {
		return this.primarySelectedElement;
	}

	getSelectedKeyframes(): SelectedKeyframeRef[] {
		return this.selectedKeyframes;
	}

	getKeyframeSelectionAnchor(): SelectedKeyframeRef | null {
		return this.keyframeSelectionAnchor;
	}

	getSelectedMaskPointSelection(): SelectedMaskPointSelection | null {
		return this.selectedMaskPoints;
	}

	getActiveSelectionKind(): EditorSelectionKind | null {
		if ((this.selectedMaskPoints?.pointIds.length ?? 0) > 0) {
			return "mask-points";
		}
		if (this.selectedKeyframes.length > 0) {
			return "keyframes";
		}
		if (this.selectedElements.length > 0) {
			return "elements";
		}
		return null;
	}

	getSnapshot(): EditorSelectionSnapshot {
		return {
			selectedElements: [...this.selectedElements],
			elementSelectionMode: this.elementSelectionMode,
			primarySelectedElement: this.primarySelectedElement
				? { ...this.primarySelectedElement }
				: null,
			selectedKeyframes: [...this.selectedKeyframes],
			keyframeSelectionAnchor: this.keyframeSelectionAnchor,
			selectedMaskPoints: this.selectedMaskPoints
				? {
						...this.selectedMaskPoints,
						pointIds: [...this.selectedMaskPoints.pointIds],
					}
				: null,
		};
	}

	selectElement({
		element,
		mode = "individual",
	}: {
		element: ElementRef;
		mode?: ElementSelectionMode;
	}): void {
		this.setSelectedElements({ elements: [element], mode, primary: element });
	}

	setSelectedElements({
		elements,
		mode = "individual",
		primary,
	}: {
		elements: ElementRef[];
		mode?: ElementSelectionMode;
		primary?: ElementRef | null;
	}): void {
		this.selectedElements = dedupeElementRefs(elements);
		this.elementSelectionMode =
			this.selectedElements.length === 0 ? "individual" : mode;
		this.primarySelectedElement = resolvePrimaryElement({
			elements: this.selectedElements,
			primary,
		});
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.notify();
	}

	setSelectedKeyframes({
		keyframes,
		anchorKeyframe,
	}: {
		keyframes: SelectedKeyframeRef[];
		anchorKeyframe?: SelectedKeyframeRef | null;
	}): void {
		this.selectedKeyframes = keyframes;
		if (anchorKeyframe !== undefined) {
			this.keyframeSelectionAnchor = anchorKeyframe;
		} else if (keyframes.length === 0) {
			this.keyframeSelectionAnchor = null;
		}
		this.selectedMaskPoints = null;
		this.notify();
	}

	setSelectedMaskPoints({
		selection,
	}: {
		selection: SelectedMaskPointSelection | null;
	}): void {
		this.selectedMaskPoints =
			selection && selection.pointIds.length > 0
				? {
						...selection,
						pointIds: [...selection.pointIds],
					}
				: null;
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.notify();
	}

	clearSelection(): void {
		this.selectedElements = [];
		this.elementSelectionMode = "individual";
		this.primarySelectedElement = null;
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.notify();
	}

	clearKeyframeSelection(): void {
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.notify();
	}

	clearMaskPointSelection(): void {
		if (!this.selectedMaskPoints) {
			return;
		}
		this.selectedMaskPoints = null;
		this.notify();
	}

	clearMostSpecificSelection(): boolean {
		const activeSelectionKind = this.getActiveSelectionKind();
		if (activeSelectionKind === "mask-points") {
			this.clearMaskPointSelection();
			return true;
		}
		if (activeSelectionKind === "keyframes") {
			this.clearKeyframeSelection();
			return true;
		}
		if (activeSelectionKind === "elements") {
			this.setSelectedElements({ elements: [] });
			return true;
		}
		return false;
	}

	applySelectionPatch({
		patch,
	}: {
		patch: EditorSelectionPatch;
	}): EditorSelectionSnapshot {
		if (patch.selectedElements !== undefined) {
			this.selectedElements = dedupeElementRefs(patch.selectedElements);
		}
		if (patch.elementSelectionMode !== undefined) {
			this.elementSelectionMode = patch.elementSelectionMode;
		}
		if (patch.primarySelectedElement !== undefined) {
			this.primarySelectedElement = resolvePrimaryElement({
				elements: this.selectedElements,
				primary: patch.primarySelectedElement,
			});
		} else if (patch.selectedElements !== undefined) {
			this.primarySelectedElement = resolvePrimaryElement({
				elements: this.selectedElements,
				primary: this.primarySelectedElement,
			});
		}
		if (this.selectedElements.length === 0) {
			this.elementSelectionMode = "individual";
		}
		if (patch.selectedKeyframes !== undefined) {
			this.selectedKeyframes = [...patch.selectedKeyframes];
		}
		if (patch.keyframeSelectionAnchor !== undefined) {
			this.keyframeSelectionAnchor = patch.keyframeSelectionAnchor;
		}
		if (patch.selectedMaskPoints !== undefined) {
			this.selectedMaskPoints = patch.selectedMaskPoints
				? {
						...patch.selectedMaskPoints,
						pointIds: [...patch.selectedMaskPoints.pointIds],
					}
				: null;
		}
		this.notify();
		return this.getSnapshot();
	}

	restoreSnapshot({ snapshot }: { snapshot: EditorSelectionSnapshot }): void {
		this.selectedElements = dedupeElementRefs(snapshot.selectedElements);
		this.elementSelectionMode =
			this.selectedElements.length === 0
				? "individual"
				: snapshot.elementSelectionMode;
		this.primarySelectedElement = resolvePrimaryElement({
			elements: this.selectedElements,
			primary: snapshot.primarySelectedElement,
		});
		this.selectedKeyframes = [...snapshot.selectedKeyframes];
		this.keyframeSelectionAnchor = snapshot.keyframeSelectionAnchor;
		this.selectedMaskPoints = snapshot.selectedMaskPoints
			? {
					...snapshot.selectedMaskPoints,
					pointIds: [...snapshot.selectedMaskPoints.pointIds],
				}
			: null;
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}

function elementRefKey({ trackId, elementId }: ElementRef): string {
	return `${trackId}:${elementId}`;
}

function dedupeElementRefs(elements: ElementRef[]): ElementRef[] {
	const seen = new Set<string>();
	const result: ElementRef[] = [];
	for (const element of elements) {
		const key = elementRefKey(element);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(element);
	}
	return result;
}

function resolvePrimaryElement({
	elements,
	primary,
}: {
	elements: ElementRef[];
	primary?: ElementRef | null;
}): ElementRef | null {
	if (elements.length === 0) return null;
	if (primary) {
		const primaryKey = elementRefKey(primary);
		const match = elements.find((element) => elementRefKey(element) === primaryKey);
		if (match) return { ...match };
	}
	return { ...elements[0]! };
}
