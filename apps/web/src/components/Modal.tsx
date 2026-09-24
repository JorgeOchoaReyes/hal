"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A lightweight, dependency-free modal. Renders a backdrop + centered panel,
 * closes on Escape or backdrop click, and locks body scroll while open. Used
 * for flows that used to be inline forms (e.g. provisioning a testing agent).
 *
 * The backdrop is portaled to `document.body` so its `position: fixed` is
 * relative to the real viewport. Otherwise a transformed/animated ancestor
 * (the page's motion wrapper) becomes the containing block for the fixed
 * element, and `inset:0` / `100vh` map to the scrolled content area instead of
 * the window — which clipped the panel (and its submit buttons) on short
 * viewports.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Only portal after mount so SSR and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className={`modal${wide ? " wide" : ""}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
