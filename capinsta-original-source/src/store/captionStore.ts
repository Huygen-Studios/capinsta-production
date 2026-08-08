/* Caption Store — caption list state and operations */

import { create } from "zustand";
import { Caption, CaptionCoverageReport, CaptionDocument, CaptionTheme, CAPTION_THEMES } from "@/lib/types";
import { applyManualCaptionTiming, generateCaptionId, normalizeCaptionWords } from "@/lib/captionUtils";
import { recordProjectHistory } from "@/lib/projectHistory";

function syncDocumentChunks(captionDocument: CaptionDocument | null, captions: Caption[]) {
  return captionDocument ? { ...captionDocument, chunks: captions } : captionDocument;
}

interface CaptionState {
  captions: Caption[];
  captionDocument: CaptionDocument | null;
  selectedIds: Set<string>;
  editingId: string | null;

  // CRUD
  setCaptions: (captions: Caption[]) => void;
  setCaptionDocument: (document: CaptionDocument | null) => void;
  setCaptionCoverageReport: (report: CaptionCoverageReport | null) => void;
  addCaption: (caption: Omit<Caption, "id">) => void;
  updateCaption: (id: string, updates: Partial<Caption>) => void;
  deleteCaption: (id: string) => void;
  deleteSelected: () => void;
  clearAll: () => void;

  // Selection
  selectCaption: (id: string, multi?: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setEditingId: (id: string | null) => void;

  // Operations
  splitCaption: (id: string, splitTime: number) => void;
  mergeCaptions: (ids: string[]) => void;
  setThemeForAll: (theme: CaptionTheme) => void;

  // Undo/Redo
  history: Caption[][];
  historyIndex: number;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Get caption at time
  getCaptionAtTime: (time: number) => Caption | undefined;
}

export const useCaptionStore = create<CaptionState>((set, get) => ({
  captions: [],
  captionDocument: null,
  selectedIds: new Set(),
  editingId: null,
  history: [],
  historyIndex: -1,

  setCaptions: (captions) => {
    recordProjectHistory("Set captions");
    get().pushHistory();
    set((s) => ({ captions, captionDocument: syncDocumentChunks(s.captionDocument, captions) }));
  },

  setCaptionDocument: (document) => {
    set({
      captionDocument: document,
      captions: document?.chunks || [],
      selectedIds: new Set(),
      editingId: null,
    });
  },

  setCaptionCoverageReport: (report) => {
    set((s) => ({
      captionDocument: s.captionDocument
        ? report
          ? { ...s.captionDocument, coverageReport: report }
          : { ...s.captionDocument, coverageReport: undefined }
        : s.captionDocument,
    }));
  },

  addCaption: (caption) => {
    recordProjectHistory("Add caption");
    get().pushHistory();
    const newCaption: Caption = { ...caption, id: generateCaptionId() };
    set((s) => {
      const captions = [...s.captions, newCaption];
      return { captions, captionDocument: syncDocumentChunks(s.captionDocument, captions) };
    });
  },

  updateCaption: (id, updates) => {
    recordProjectHistory("Update caption", { debounceKey: `caption:${id}`, debounceMs: 700 });
    get().pushHistory();
    set((s) => {
      const captions = s.captions.map((c) => {
        if (c.id !== id) return c;
        if ((updates.start !== undefined || updates.end !== undefined) && updates.words === undefined) {
          const timed = applyManualCaptionTiming(c, updates.start ?? c.start, updates.end ?? c.end);
          const restUpdates = { ...updates };
          delete restUpdates.start;
          delete restUpdates.end;
          return { ...timed, ...restUpdates, words: timed.words, timingWarning: timed.timingWarning };
        }
        return { ...c, ...updates };
      });
      return { captions, captionDocument: syncDocumentChunks(s.captionDocument, captions) };
    });
  },

  deleteCaption: (id) => {
    recordProjectHistory("Delete caption");
    get().pushHistory();
    set((s) => {
      const captions = s.captions.filter((c) => c.id !== id);
      return {
        captions,
        captionDocument: syncDocumentChunks(s.captionDocument, captions),
        selectedIds: new Set(Array.from(s.selectedIds).filter((sid) => sid !== id)),
      };
    });
  },

  deleteSelected: () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    recordProjectHistory("Delete selected captions");
    get().pushHistory();
    set((s) => {
      const captions = s.captions.filter((c) => !selectedIds.has(c.id));
      return {
        captions,
        captionDocument: syncDocumentChunks(s.captionDocument, captions),
        selectedIds: new Set(),
      };
    });
  },

  clearAll: () => {
    recordProjectHistory("Clear captions");
    get().pushHistory();
    set({ captions: [], captionDocument: null, selectedIds: new Set(), editingId: null });
  },

  selectCaption: (id, multi = false) => {
    set((s) => {
      const newSet = new Set(multi ? s.selectedIds : []);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedIds: newSet };
    });
  },

  selectAll: () =>
    set((s) => ({ selectedIds: new Set(s.captions.map((c) => c.id)) })),

  deselectAll: () => set({ selectedIds: new Set() }),

  setEditingId: (id) => set({ editingId: id }),

  splitCaption: (id, splitTime) => {
    const caption = get().captions.find((c) => c.id === id);
    if (!caption || splitTime <= caption.start || splitTime >= caption.end)
      return;

    recordProjectHistory("Split caption");
    get().pushHistory();
    const timedWords = normalizeCaptionWords(caption);
    const words = caption.text.split(" ");
    const ratio = (splitTime - caption.start) / (caption.end - caption.start);
    const splitIndex = Math.max(1, Math.round(words.length * ratio));

    const text1 = words.slice(0, splitIndex).join(" ");
    const text2 = words.slice(splitIndex).join(" ");
    const firstWords = timedWords.filter((word) => word.start < splitTime);
    const secondWords = timedWords.filter((word) => word.end >= splitTime);

    set((s) => {
      const captions = s.captions.flatMap((c) =>
        c.id === id
          ? [
              {
                ...c,
                end: splitTime,
                text: firstWords.length ? firstWords.map((word) => word.displayedWord || word.word).join(" ") : text1,
                words: firstWords,
                originalText: firstWords.length ? firstWords.map((word) => word.originalWord || word.word).join(" ") : c.originalText,
              },
              {
                ...c,
                id: generateCaptionId(),
                start: splitTime,
                text: secondWords.length ? secondWords.map((word) => word.displayedWord || word.word).join(" ") : text2,
                words: secondWords,
                originalText: secondWords.length ? secondWords.map((word) => word.originalWord || word.word).join(" ") : c.originalText,
              },
            ]
          : [c]
      );
      return { captions, captionDocument: syncDocumentChunks(s.captionDocument, captions) };
    });
  },

  mergeCaptions: (ids) => {
    if (ids.length < 2) return;
    recordProjectHistory("Merge captions");
    get().pushHistory();
    const toMerge = get()
      .captions.filter((c) => ids.includes(c.id))
      .sort((a, b) => a.start - b.start);

    if (toMerge.length < 2) return;

    const merged: Caption = {
      id: toMerge[0].id,
      start: toMerge[0].start,
      end: toMerge[toMerge.length - 1].end,
      text: toMerge.map((c) => c.text).join(" "),
      originalText: toMerge.map((c) => c.originalText || c.text).join(" "),
      words: toMerge.flatMap(normalizeCaptionWords).sort((a, b) => a.start - b.start),
      manuallyEdited: toMerge.some((c) => c.manuallyEdited),
      timingNeedsReview: toMerge.some((c) => c.timingNeedsReview),
      timingWarning: toMerge.find((c) => c.timingWarning)?.timingWarning,
      lang: toMerge[0].lang,
      theme: toMerge[0].theme,
      trackId: toMerge[0].trackId,
      sourceMediaId: toMerge[0].sourceMediaId,
      style: toMerge[0].style,
    };

    const mergeIds = new Set(ids.slice(1));
    set((s) => {
      const captions = s.captions
        .filter((c) => !mergeIds.has(c.id))
        .map((c) => (c.id === merged.id ? merged : c));
      return {
        captions,
        captionDocument: syncDocumentChunks(s.captionDocument, captions),
        selectedIds: new Set(),
      };
    });
  },

  setThemeForAll: (theme) => {
    recordProjectHistory("Caption style");
    get().pushHistory();
    set((s) => {
      const captions = s.captions.map((c) => ({ ...c, theme, style: CAPTION_THEMES[theme] }));
      return { captions, captionDocument: syncDocumentChunks(s.captionDocument, captions) };
    });
  },

  pushHistory: () =>
    set((s) => {
      const newHistory = s.history.slice(0, s.historyIndex + 1);
      newHistory.push([...s.captions]);
      // Keep max 50 history entries
      if (newHistory.length > 50) newHistory.shift();
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    }),

  undo: () =>
    set((s) => {
      if (s.historyIndex < 0) return s;
      const captions = s.history[s.historyIndex];
      return {
        captions: captions || s.captions,
        captionDocument: syncDocumentChunks(s.captionDocument, captions || s.captions),
        historyIndex: s.historyIndex - 1,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s;
      const captions = s.history[s.historyIndex + 1];
      return {
        captions: captions || s.captions,
        captionDocument: syncDocumentChunks(s.captionDocument, captions || s.captions),
        historyIndex: s.historyIndex + 1,
      };
    }),

  getCaptionAtTime: (time) =>
    get().captions.find((c) => time >= c.start && time < c.end),
}));
