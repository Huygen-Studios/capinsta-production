"use client";

import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousActive?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-header">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle size={17} className={destructive ? "confirm-dialog-danger-icon" : ""} />
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} title="Close">
            <X size={15} />
          </button>
        </div>
        <p className="confirm-dialog-body">{body}</p>
        <div className="confirm-dialog-actions">
          <button ref={cancelButtonRef} className="btn-ghost" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn-primary ${destructive ? "btn-danger" : ""}`} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
