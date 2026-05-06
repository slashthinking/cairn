// Lightweight toast system. Imperative API via global emitter.
// Components call `toast.success("...")` etc. and ToastHost renders the queue.

import { Check, Info, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Variant = "success" | "info" | "error";

export interface ToastItem {
  id: number;
  variant: Variant;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

const listeners = new Set<(t: ToastItem) => void>();
let counter = 0;

export const toast = {
  success(title: string, detail?: string, action?: ToastItem["action"]) {
    push({ id: ++counter, variant: "success", title, detail, action });
  },
  info(title: string, detail?: string, action?: ToastItem["action"]) {
    push({ id: ++counter, variant: "info", title, detail, action });
  },
  error(title: string, detail?: string, action?: ToastItem["action"]) {
    push({ id: ++counter, variant: "error", title, detail, action });
  },
};

function push(t: ToastItem) {
  for (const l of listeners) l(t);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handle = (t: ToastItem) => {
      setItems((cur) => [...cur, t]);
      const ttl = t.variant === "error" ? 6000 : 3500;
      setTimeout(() => {
        setItems((cur) => cur.filter((x) => x.id !== t.id));
      }, ttl);
    };
    listeners.add(handle);
    return () => {
      listeners.delete(handle);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-cc-md border bg-cc-surface-elevated px-3.5 py-3 shadow-xl ${
        item.variant === "error" ? "border-destructive" : "border-border"
      }`}
    >
      {item.variant === "success" && (
        <Check className="h-4 w-4 text-cc-success" />
      )}
      {item.variant === "info" && (
        <Info className="h-4 w-4 text-cc-accent-light" />
      )}
      {item.variant === "error" && (
        <AlertCircle className="h-4 w-4 text-destructive" />
      )}
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-foreground">
          {item.title}
        </div>
        {item.detail && (
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {item.detail}
          </div>
        )}
      </div>
      {item.action && (
        <button
          onClick={item.action.onClick}
          className="text-[12px] font-semibold text-cc-accent-light hover:underline"
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}
