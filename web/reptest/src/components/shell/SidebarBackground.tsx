/// <reference types="vite/client" />
import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";

// Optional local source, never a required dependency of the public checkout.
const modules = import.meta.env.VITE_RELAY_PRIVATE_EFFECTS === "1"
  ? import.meta.glob<{ default: ComponentType<Record<string, unknown>> }>("../../private/reactbits/glowing-ridges.tsx")
  : {};
const load = Object.values(modules)[0];
const Ridges = load ? lazy(load) : null;

class EffectBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function SidebarBackground({ enabled, reducedMotion }: { enabled: boolean; reducedMotion: boolean }) {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return (
    <div className="sidebar-backdrop" aria-hidden="true" data-private-effect={Boolean(Ridges)}>
      {enabled && Ridges && <EffectBoundary><Suspense fallback={null}>
        <Ridges
          className="h-full w-full"
          detail={7}
          turbulence={1.1500000000000001}
          zoom={1.25}
          shiftX={0.5800000000000001}
          ridgePhase={1.7}
          density={10.5}
          flowSpeed={0.5}
          churnSpeed={2.4000000000000004}
          gain={2.15}
          colorA="#22207c"
          colorB="#7001ff"
          backgroundColor="#05031d"
          paused={reducedMotion || !visible}
        />
      </Suspense></EffectBoundary>}
    </div>
  );
}
