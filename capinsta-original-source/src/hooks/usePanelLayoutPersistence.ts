"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const PANEL_LAYOUT_KEY = "huygen-caps-panel-layout-v1";
export const RESET_PANEL_LAYOUT_EVENT = "huygen-caps-reset-layout";

type PanelLayouts = {
  vertical: number[];
  horizontal: number[];
  tabletVertical: number[];
  tabletHorizontal: number[];
};

const DEFAULT_LAYOUTS: PanelLayouts = {
  vertical: [68, 32],
  horizontal: [22, 56, 22],
  tabletVertical: [66, 34],
  tabletHorizontal: [64, 36],
};

function cleanLayout(value: unknown, fallback: number[]) {
  if (!Array.isArray(value) || value.length !== fallback.length) return fallback;
  const next = value.map((item) => Number(item));
  if (next.some((item) => !Number.isFinite(item) || item <= 0)) return fallback;
  return next;
}

export function usePanelLayoutPersistence() {
  const [layouts, setLayouts] = useState<PanelLayouts>(DEFAULT_LAYOUTS);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PANEL_LAYOUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PanelLayouts>;
      setLayouts({
        vertical: cleanLayout(parsed.vertical, DEFAULT_LAYOUTS.vertical),
        horizontal: cleanLayout(parsed.horizontal, DEFAULT_LAYOUTS.horizontal),
        tabletVertical: cleanLayout(parsed.tabletVertical, DEFAULT_LAYOUTS.tabletVertical),
        tabletHorizontal: cleanLayout(parsed.tabletHorizontal, DEFAULT_LAYOUTS.tabletHorizontal),
      });
    } catch {
      setLayouts(DEFAULT_LAYOUTS);
    }
  }, []);

  const saveLayout = useCallback((key: keyof PanelLayouts, value: number[]) => {
    setLayouts((current) => {
      const next = { ...current, [key]: value };
      window.localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    window.localStorage.removeItem(PANEL_LAYOUT_KEY);
    setLayouts(DEFAULT_LAYOUTS);
    setLayoutVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(RESET_PANEL_LAYOUT_EVENT, resetLayout);
    return () => window.removeEventListener(RESET_PANEL_LAYOUT_EVENT, resetLayout);
  }, [resetLayout]);

  return useMemo(() => ({ layouts, saveLayout, resetLayout, layoutVersion }), [layoutVersion, layouts, resetLayout, saveLayout]);
}
