import type { Config } from "tailwindcss";

// Mirrors design tokens defined in cc_session.pen + src/styles/globals.css.
// Each token reference (`bg-cc-surface-base`) resolves via CSS custom property
// so light/dark swap with one html class flip.

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Brand / semantic
        "cc-accent": "var(--cc-accent)",
        "cc-accent-light": "var(--cc-accent-light)",
        "cc-accent-fg": "var(--cc-accent-fg)",
        "cc-claude": "var(--cc-claude)",
        "cc-success": "var(--cc-success)",
        "cc-text-on-accent-soft": "var(--cc-text-on-accent-soft)",
        "cc-text-on-accent-mute": "var(--cc-text-on-accent-mute)",

        // Surface
        "cc-surface-base": "var(--cc-surface-base)",
        "cc-surface-elevated": "var(--cc-surface-elevated)",
        "cc-surface-hover": "var(--cc-surface-hover)",
        "cc-surface-press": "var(--cc-surface-press)",
        "cc-surface-strong": "var(--cc-surface-strong)",
        "cc-card": "var(--cc-card)",
        "cc-card-foreground": "var(--cc-card-foreground)",

        // shadcn semantic
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        input: "var(--input)",
        sidebar: "var(--sidebar)",
        secondary: "var(--secondary)",
        destructive: "var(--destructive)",
        "stale-foreground": "var(--stale-foreground)",
      },
      borderRadius: {
        "cc-xs": "var(--cc-radius-xs)",
        "cc-sm": "var(--cc-radius-sm)",
        "cc-md": "var(--cc-radius-md)",
        "cc-lg": "var(--cc-radius-lg)",
        "cc-xl": "var(--cc-radius-xl)",
      },
      fontFamily: {
        sans: "var(--cc-font-english)",
        mono: "var(--cc-font-mono)",
        logo: "var(--cc-font-logo)",
      },
    },
  },
  plugins: [],
} satisfies Config;
