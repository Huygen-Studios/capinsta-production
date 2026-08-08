"use client";

import React from "react";
import { X } from "lucide-react";

export type MobileSheetSize = "compact" | "medium" | "expanded";

interface MobileBottomSheetProps {
  title: string;
  size?: MobileSheetSize;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function MobileBottomSheet({ title, size = "medium", onClose, children, footer }: MobileBottomSheetProps) {
  return (
    <section className={`mobile-bottom-sheet mobile-bottom-sheet-${size}`} aria-label={title}>
      <div className="mobile-sheet-handle" />
      <div className="mobile-sheet-header">
        <button className="mobile-sheet-close" onClick={onClose} title="Close">
          <X size={20} />
        </button>
        <div className="mobile-sheet-title">{title}</div>
        <div className="w-8" />
      </div>
      <div className="mobile-sheet-body">{children}</div>
      {footer && <div className="mobile-sheet-footer">{footer}</div>}
    </section>
  );
}
