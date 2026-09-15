import { useEffect, useRef } from "react";
import { Check, Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type Accent, type SidebarVariant } from "./ThemeProvider";
import { Button, Segmented, Switch } from "@/components/ui";

import { INTERFACE_FONTS, normalizeFont } from "./fonts";

const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "blue", label: "Blue (default)", swatch: "#2f6fed" },
  { id: "teal", label: "Teal", swatch: "#0f8f8a" },
  { id: "violet", label: "Violet", swatch: "#6d4fe0" },
  { id: "amber", label: "Amber", swatch: "#b8700a" },
  { id: "rose", label: "Rose", swatch: "#d2385a" },
  { id: "mono", label: "Monochrome", swatch: "#17171c" },
];

const RADII = [0, 4, 8, 12, 16];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-border px-4 py-4 last:border-b-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Customizer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, set, reset } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button className="absolute inset-0 bg-black/20" aria-label="Close customizer" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customizer-title"
        className="t-pane relative flex h-full w-[340px] max-w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="customizer-title" className="text-sm font-semibold">Appearance</h2>
            <p className="text-xs text-muted">Saved on this device for your account</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Section title="Mode">
          <Segmented
            ariaLabel="Color mode"
            value={theme.mode}
            onChange={(v) => set("mode", v)}
            options={[
              { value: "light", label: <span className="flex items-center gap-1"><Sun className="h-3 w-3" /> Light</span> },
              { value: "dark", label: <span className="flex items-center gap-1"><Moon className="h-3 w-3" /> Dark</span> },
              { value: "system", label: <span className="flex items-center gap-1"><Monitor className="h-3 w-3" /> System</span> },
            ]}
          />
        </Section>

        <Section title="Font" hint="Choose your interface typeface. Code and logs keep their monospace font.">
          <label className="text-xs text-muted" htmlFor="interface-font">Sans font</label>
          <select
            id="interface-font"
            aria-label="Interface font"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            value={theme.fontFamily}
            onChange={(event) => set("fontFamily", normalizeFont(event.target.value))}
          >
            {INTERFACE_FONTS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
          </select>
          <p className="rounded-md border border-border p-3 text-sm" aria-label="Font preview">Team context, clear decisions. Ação, revisão. 0123456789</p>
          <p className="text-xs text-muted">Saved on this device. All fonts are bundled for offline use.</p>
        </Section>

        <Section title="Surface style" hint="Glass adds frosted panels and a soft gradient backdrop.">
          <Segmented
            ariaLabel="Surface style"
            value={theme.material}
            onChange={(v) => set("material", v)}
            options={[
              { value: "standard", label: "Standard" },
              { value: "glassmorphism", label: "Glassmorphism" },
            ]}
          />
        </Section>

        <Section title="Accent" hint="Blue matches the sidebar effect and grid. Other presets are yours to choose.">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={theme.accent === a.id}
                onClick={() => set("accent", a.id)}
                className={cn(
                  "t-control flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs",
                  theme.accent === a.id ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong"
                )}
              >
                <span className="grid h-4 w-4 flex-none place-items-center rounded-full" style={{ background: a.swatch }}>
                  {theme.accent === a.id ? <Check className="h-3 w-3 text-white" /> : null}
                </span>
                <span className="truncate">{a.label.replace(" (default)", "")}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Radius">
          <div className="flex gap-2" role="radiogroup" aria-label="Corner radius">
            {RADII.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={theme.radius === r}
                onClick={() => set("radius", r)}
                className={cn("t-control tnum h-8 flex-1 border text-xs", theme.radius === r ? "border-accent bg-accent-soft text-accent-text" : "border-border hover:border-border-strong")}
                style={{ borderRadius: r }}
              >
                {r}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Sidebar">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Sidebar variant">
            {(["sidebar", "floating", "inset"] as SidebarVariant[]).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={theme.sidebar === v}
                onClick={() => set("sidebar", v)}
                className={cn("t-control grid gap-1.5 rounded-md border p-2 text-xs", theme.sidebar === v ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong")}
              >
                <span className="flex h-9 gap-1 rounded-sm bg-surface-2 p-1" aria-hidden>
                  <span className={cn("h-full w-3 bg-border-strong", v === "floating" && "rounded-sm", v === "inset" && "bg-transparent border border-border-strong")} />
                  <span className={cn("h-full flex-1 bg-surface", v === "inset" && "rounded-sm border border-border-strong")} />
                </span>
                <span className="capitalize">{v}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs">Start collapsed</span>
            <Switch checked={theme.sidebarCollapsed} onCheckedChange={(v) => set("sidebarCollapsed", v)} label="Collapse sidebar" />
          </div>
        </Section>

        <Section title="Content">
          <div className="flex items-center justify-between">
            <span className="text-xs">Layout</span>
            <Segmented size="sm" ariaLabel="Content layout" value={theme.layout} onChange={(v) => set("layout", v)} options={[{ value: "full", label: "Full width" }, { value: "centered", label: "Centered" }]} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Density</span>
            <Segmented size="sm" ariaLabel="Density" value={theme.density} onChange={(v) => set("density", v)} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Text size</span>
            <Segmented
              size="sm"
              ariaLabel="Text size"
              value={String(theme.fontScale) as "0.9" | "1" | "1.1"}
              onChange={(v) => set("fontScale", Number(v))}
              options={[
                { value: "0.9", label: "S" },
                { value: "1", label: "M" },
                { value: "1.1", label: "L" },
              ]}
            />
          </div>
        </Section>

        <Section title="Motion and effects" hint="Ambient effects stay in navigation only and pause when the tab is hidden.">
          <div className="flex items-center justify-between">
            <span className="text-xs">Reduce motion</span>
            <Switch checked={theme.reducedMotion} onCheckedChange={(v) => set("reducedMotion", v)} label="Reduce motion" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Ambient sidebar effect</span>
            <Switch checked={theme.ambientEffects} onCheckedChange={(v) => set("ambientEffects", v)} label="Ambient sidebar effect" />
          </div>
        </Section>

        <div className="mt-auto flex items-center justify-between px-4 py-3">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <Button variant="default" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
