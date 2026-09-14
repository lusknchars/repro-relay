// Adapted from PaceUI Ultimate Dashboard. See THIRD_PARTY_NOTICES.md.
import { lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { Footer } from "./footer";
import { DemoAdminSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
const PerspectiveGrid=lazy(()=>import('@/components/react-bits/perspective-grid'));

export type View = 'sessions' | 'overview' | 'inbox' | 'agents' | 'memory' | 'handoffs' | 'connections';
export const AdminLayout = ({ children, view, navigate, search, guest = false, connected = false }: {
 children: ReactNode; view: View; navigate: (view: View) => void; search: () => void; guest?: boolean; connected?: boolean;
}) => <SidebarProvider style={{"--sidebar-width": "250px"} as CSSProperties}>
 <a className="skip-link" href="#workspace">Skip to workspace</a>
 <DemoAdminSidebar view={view} navigate={navigate} guest={guest} connected={connected}/>
 <SidebarInset className="min-w-0">
  <Topbar view={view} search={search} guest={guest}/>
  <div id="workspace" tabIndex={-1} className={'flex min-w-0 flex-1 flex-col p-4 sm:p-5'+(view==='connections'?' configuration-workspace':'')}>
   {view==='connections'&&<div className="configuration-background" aria-hidden="true"><Suspense fallback={null}>
    <PerspectiveGrid
     height="100%"
     speed={1}
     color="var(--effect-blue)"
     bottomFade="var(--sidebar)"
     gridScale={2.7}
     lineThickness={0.1}
     fadeSmoothness={0.9500000000000001}
     perspective={-30}
     gridLength={13}
     curve={2.3000000000000003}
    />
   </Suspense></div>}
   {children}
  </div>
  <div className="mb-3 px-6"><Footer/></div>
 </SidebarInset>
</SidebarProvider>;
