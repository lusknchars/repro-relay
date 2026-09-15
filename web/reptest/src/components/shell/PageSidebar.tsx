import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./page-sidebar.css";

const Sidebar = createContext<{
  target: HTMLDivElement | null;
  mount: (element: HTMLDivElement | null) => void;
} | null>(null);

export function PageSidebarProvider({ children }: { children: ReactNode }) {
  const [target, mount] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, mount }), [target]);
  return <Sidebar.Provider value={value}>{children}</Sidebar.Provider>;
}

export function PageSidebarMount() {
  const sidebar = useContext(Sidebar);
  return <div ref={sidebar?.mount} className="page-sidebar-body" />;
}

// Page state owns the controls. Moving them into the shell adds no extra API reads.
export function PageSidebar({ children }: { children: ReactNode }) {
  const sidebar = useContext(Sidebar);
  return sidebar?.target ? createPortal(children, sidebar.target) : null;
}
