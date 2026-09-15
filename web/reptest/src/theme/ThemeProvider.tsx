import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fontStack, normalizeFont, type InterfaceFont } from "./fonts";
import "./font-faces.css";

export type Mode = "light" | "dark" | "system";
export type Accent = "blue" | "teal" | "violet" | "amber" | "rose" | "mono";
export type SidebarVariant = "sidebar" | "floating" | "inset";
export type ContentLayout = "full" | "centered";
export type Density = "compact" | "comfortable";

export interface ThemeSettings {
  fontFamily: InterfaceFont;
  mode: Mode;
  accent: Accent;
  radius: number; // px
  sidebar: SidebarVariant;
  sidebarCollapsed: boolean;
  layout: ContentLayout;
  density: Density;
  fontScale: number; // 0.9 – 1.1
  reducedMotion: boolean;
  ambientEffects: boolean;
}

export const DEFAULT_THEME: ThemeSettings = {
  fontFamily: "sans",
  mode: "system",
  accent: "blue",
  radius: 8,
  sidebar: "sidebar",
  sidebarCollapsed: false,
  layout: "full",
  density: "comfortable",
  fontScale: 1,
  reducedMotion: false,
  ambientEffects: true,
};

const STORAGE_KEY = "reptest.theme.v1";

interface ThemeContextValue {
  theme: ThemeSettings;
  set: <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) => void;
  reset: () => void;
  resolvedMode: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadSettings(): ThemeSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const saved = JSON.parse(raw) as Partial<ThemeSettings>;
    return { ...DEFAULT_THEME, ...saved, fontFamily: normalizeFont(saved?.fontFamily) };
  } catch {
    return DEFAULT_THEME; // storage unavailable (e.g. sandboxed preview) — keep settings in memory
  }
}

function saveSettings(s: ThemeSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeSettings>(loadSettings);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);

  const resolvedMode: "light" | "dark" = theme.mode === "system" ? (systemDark ? "dark" : "light") : theme.mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedMode === "dark");
    root.classList.toggle("reduce-motion", theme.reducedMotion);
    root.dataset.accent = theme.accent;
    root.dataset.font = normalizeFont(theme.fontFamily);
    root.style.setProperty("--font-sans", fontStack(normalizeFont(theme.fontFamily)));
    root.style.setProperty("--radius", `${theme.radius}px`);
    root.style.setProperty("--density", theme.density === "compact" ? "0.7" : "1");
    root.style.setProperty("--font-scale", String(theme.fontScale));
    root.style.setProperty("--content-max", theme.layout === "centered" ? "1280px" : "100%");
    root.style.colorScheme = resolvedMode;
    saveSettings(theme);
  }, [theme, resolvedMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedMode,
      set: (key, v) => setTheme((t) => ({ ...t, [key]: v })),
      reset: () => setTheme(DEFAULT_THEME),
    }),
    [theme, resolvedMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
