// Lightweight right-click menu. Renders into document.body via React portal,
// positions itself at the cursor, and dismisses on outside click / Escape /
// scroll. Designed for project + session row menus — not deeply nested submenus.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

export interface MenuItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  separatorAfter?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface MenuApi {
  open: (e: React.MouseEvent, items: MenuItem[]) => void;
  close: () => void;
}

const Ctx = createContext<MenuApi | null>(null);

export function ContextMenuProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (items.length === 0) return;
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  // Outside click + Escape + scroll dismiss
  useEffect(() => {
    if (!state) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    // Defer until next frame — otherwise the right-click that opened the menu
    // also fires the dismiss handler before paint.
    const id = window.requestAnimationFrame(() => {
      window.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScroll, true);
    });
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [state, close]);

  // Reposition so the menu doesn't overflow the viewport.
  // Measured after render via ResizeObserver since item count varies.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!state || !ref.current) {
      setSize(null);
      return;
    }
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    setSize({ w: rect.width, h: rect.height });
  }, [state]);

  const api: MenuApi = { open, close };

  let pos = { left: 0, top: 0 };
  if (state) {
    const margin = 8;
    const w = size?.w ?? 200;
    const h = size?.h ?? state.items.length * 32 + 8;
    const maxX = window.innerWidth - w - margin;
    const maxY = window.innerHeight - h - margin;
    pos = {
      left: Math.max(margin, Math.min(state.x, maxX)),
      top: Math.max(margin, Math.min(state.y, maxY)),
    };
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {state &&
        createPortal(
          <div
            ref={ref}
            role="menu"
            style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 1000 }}
            className="min-w-[180px] overflow-hidden rounded-cc-md border border-border bg-cc-surface-elevated py-1 shadow-2xl"
          >
            {state.items.map((item, i) => (
              <MenuRow
                key={i}
                item={item}
                onActivate={() => {
                  if (item.disabled) return;
                  close();
                  item.onClick();
                }}
              />
            ))}
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

function MenuRow({
  item,
  onActivate,
}: {
  item: MenuItem;
  onActivate: () => void;
}) {
  const Icon = item.icon;
  return (
    <>
      <button
        role="menuitem"
        disabled={item.disabled}
        onClick={onActivate}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
          item.disabled
            ? "cursor-default text-muted-foreground opacity-60"
            : item.destructive
              ? "text-destructive hover:bg-destructive/10"
              : "text-foreground hover:bg-cc-surface-hover",
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
      </button>
      {item.separatorAfter && (
        <div className="my-1 h-px bg-border" aria-hidden />
      )}
    </>
  );
}

export function useContextMenu(): MenuApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContextMenu requires <ContextMenuProvider>");
  return ctx;
}
