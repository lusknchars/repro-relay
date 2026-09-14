import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, BookOpen, Menu, MessagesSquare, Rocket, ChevronsUpDown, Command, Gauge, HelpCircle, Inbox, Moon, PanelLeft, Search, Settings, SlidersHorizontal, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Kbd } from "@/components/ui";
import { connections } from "@/lib/data";

export type Route = "work" | "team" | "knowledge" | "usage" | "settings" | "setup";

const NAV: { id: Route; label: string; icon: typeof Inbox; hint: string }[] = [
  { id: "work", label: "Work", icon: Inbox, hint: "Decisions, active and blocked work, history" },
  { id: "team", label: "Team", icon: MessagesSquare, hint: "Talk with your team around a work record" },
  { id: "knowledge", label: "Knowledge", icon: BookOpen, hint: "Reviewed observations and private notes" },
  { id: "usage", label: "Usage", icon: Gauge, hint: "Tokens, time and cost with coverage" },
  { id: "settings", label: "Settings", icon: Settings, hint: "Connections, repository, permissions, team" },
];

function AmbientAscii({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const fn = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  const rows = useMemo(() => {
    const chars = "·:+×#=-";
    return Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 22 }, (_, c) => ({
        ch: chars[(r * 7 + c * 3) % chars.length],
        d: ((r * 22 + c) % 11) * 0.45,
      }))
    );
  }, []);
  return (
    <div className="ambient-ascii px-3 pb-2" aria-hidden style={{ opacity: enabled ? 0.22 : 0.1 }}>
      {rows.map((row, r) => (
        <div key={r}>
          {row.map((c, i) => (
            <span key={i} style={{ "--d": `${c.d}s`, animationPlayState: enabled && visible ? "running" : "paused" } as React.CSSProperties}>
              {c.ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Shell({ route, onRoute, onOpenCustomizer, children }: { route: Route; onRoute: (r: Route) => void; onOpenCustomizer: () => void; children: ReactNode }) {
  const { theme, set, resolvedMode } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = theme.sidebarCollapsed;
  const variant = theme.sidebar;
  const decisions = 1;
  const problems = connections.filter((c) => c.status === "blocked" || c.status === "missing" || c.status === "unknown").length;

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        set("sidebarCollapsed", !collapsed);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [collapsed, set]);

  const sidebar = (
    <aside
      className={cn(
        "flex h-full flex-col bg-surface text-foreground",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-xl max-md:border-r max-md:border-border",
        !mobileOpen && "max-md:hidden",
        variant === "sidebar" && "border-r border-border",
        variant === "floating" && "m-2 rounded-lg border border-border shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        variant === "inset" && "bg-transparent"
      )}
      style={{ width: collapsed ? 56 : "var(--sidebar-w)" }}
      aria-label="Primary navigation"
    >
      <div className={cn("flex h-12 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <img
          src={`/brand/repro-relay-mark-${resolvedMode === "dark" ? "white" : "black"}.png`}
          alt={collapsed ? "Repro Relay" : ""}
          width={24}
          height={24}
          className="h-6 w-6 flex-none object-contain"
        />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">Repro Relay</div>
            <div className="truncate text-[11px] text-muted">reptest · prototype</div>
          </div>
        )}
      </div>

      <div className={cn("px-2 pb-2", collapsed && "px-1.5")}>
        <button
          className={cn("t-control flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-xs text-muted hover:text-foreground", collapsed && "justify-center px-0")}
          aria-label="Search or open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search work, evidence…</span>
              <Kbd>⌘K</Kbd>
            </>
          )}
        </button>
      </div>

      <nav className={cn("grid gap-0.5 px-2", collapsed && "px-1.5")}>
        {NAV.map((n) => {
          const Icon = n.icon;
          const current = route === n.id;
          const count = n.id === "work" ? decisions : n.id === "team" ? 3 : n.id === "settings" ? problems : 0;
          return (
            <button
              key={n.id}
              onClick={() => { onRoute(n.id); setMobileOpen(false); }}
              aria-current={current ? "page" : undefined}
              title={collapsed ? n.label : undefined}
              className={cn(
                "nav-item t-control flex h-8 items-center gap-2 rounded-md px-2 text-sm",
                current ? "bg-accent-soft text-accent-text font-medium" : "text-muted hover:bg-surface-2 hover:text-foreground",
                collapsed && "justify-center px-0"
              )}
            >
              {!collapsed && <span className="nav-dot" aria-hidden />}
              <Icon className="h-4 w-4 flex-none" />
              {!collapsed && <span className="flex-1 truncate text-left">{n.label}</span>}
              {!collapsed && count > 0 && (
                <span className={cn("tnum rounded-sm px-1 text-[11px]", n.id === "settings" ? "bg-warn-soft text-warn" : "bg-accent text-accent-foreground")}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-4 px-4">
          <div className="text-[11px] font-medium text-faint">Repository</div>
          <div className="mt-1 truncate text-xs">acme-billing</div>
          <div className="mono truncate text-[11px] text-muted">main@8f21c0e · staging-eu</div>
          <button onClick={() => { onRoute("setup"); setMobileOpen(false); }} className="t-control mt-2 flex items-center gap-1.5 text-xs text-accent-text hover:underline">
            <Rocket className="h-3 w-3" /> Replay first-run setup
          </button>
        </div>
      )}

      <div className="mt-auto">
        <AmbientAscii enabled={theme.ambientEffects} />
        {!collapsed && (
          <div className="border-t border-border px-3 py-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> Hermes investigating</span>
              <span className="tnum">$2.46 today</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" /> 1 provider blocked</div>
          </div>
        )}
        <button
          onClick={() => set("sidebarCollapsed", !collapsed)}
          className="t-control flex h-9 w-full items-center justify-center gap-2 border-t border-border text-xs text-muted hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft className="h-3.5 w-3.5" />
          {!collapsed && <span>Collapse</span>}
          {!collapsed && <Kbd>⌘B</Kbd>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className={cn("flex h-screen w-full overflow-hidden", variant === "inset" && "bg-surface-2")}>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      {sidebar}
      <div className={cn("flex min-w-0 flex-1 flex-col", variant === "inset" && "m-2 ml-0 overflow-hidden rounded-lg border border-border bg-background")}>
        <header className="flex h-12 flex-none items-center gap-2 border-b border-border bg-surface px-3">
          <button className="t-control grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <button className="t-control flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-surface-2" aria-label="Switch workspace">
            <span className="h-4 w-4 rounded-sm bg-accent-soft" aria-hidden />
            <span className="font-medium">Acme</span>
            <span className="text-faint max-sm:hidden">/</span>
            <span className="max-sm:hidden">acme-billing</span>
            <span className="text-faint">/</span>
            <span className="mono text-[11px]">main</span>
            <ChevronsUpDown className="h-3 w-3 text-muted" />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => onRoute("settings")}
              className="t-control hidden h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-surface-2 md:flex"
              aria-label="Connection state"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> 2 ready
              <span className="h-1.5 w-1.5 rounded-full bg-warn" /> 1 untested
              <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 1 blocked
            </button>
            <button className="t-control grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Help">
              <HelpCircle className="h-4 w-4" />
            </button>
            <button className="t-control grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Command palette">
              <Command className="h-4 w-4" />
            </button>
            <button
              onClick={() => set("mode", resolvedMode === "dark" ? "light" : "dark")}
              className="t-control grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
              aria-label={resolvedMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {resolvedMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={onOpenCustomizer} className="t-control grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Customize appearance">
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button className="t-control relative grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Notifications, 1 needs your decision">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            </button>
            <button className="t-control ml-1 flex h-8 items-center gap-2 rounded-md pl-1 pr-2 hover:bg-surface-2" aria-label="Account: Luskzz, Owner">
              <Avatar name="Lucas O" size={24} />
              <span className="hidden text-xs sm:inline">Luskzz</span>
              <Badge tone="outline" className="hidden sm:inline-flex">Owner</Badge>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto h-full" style={{ maxWidth: "var(--content-max)" }}>
            {children}
          </div>
        </main>
        <nav className="flex h-14 flex-none items-stretch border-t border-border bg-surface md:hidden" aria-label="Phone navigation">
          {NAV.map((n) => {
            const Icon = n.icon;
            const current = route === n.id;
            return (
              <button key={n.id} onClick={() => onRoute(n.id)} aria-current={current ? "page" : undefined} className={cn("t-control flex min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", current ? "text-accent-text" : "text-muted")}>
                <Icon className="h-4 w-4" /> {n.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
