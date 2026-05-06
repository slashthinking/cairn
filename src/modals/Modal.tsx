// Shared modal shell with backdrop + ESC-to-close.

import { useEffect } from "react";

interface Props {
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

export function Modal({ onClose, width = 520, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="flex max-h-[calc(100vh-48px)] flex-col overflow-hidden rounded-cc-lg border border-border bg-cc-surface-elevated shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}
