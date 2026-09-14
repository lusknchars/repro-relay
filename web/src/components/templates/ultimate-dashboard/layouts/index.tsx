// Adapted from PaceUI Ultimate Dashboard. See THIRD_PARTY_NOTICES.md.
import { lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { Footer } from "./footer";
import { DemoAdminSidebar, primaryViews, workViews } from "./sidebar";
import { Topbar } from "./topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAppearance } from '@/components/reptest/Appearance';
const PerspectiveGrid=lazy(()=>import('@/components/react-bits/perspective-grid'));

export type View = 'sessions' | 'overview' | 'inbox' | 'agents' | 'memory' | 'handoffs' | 'connections' | 'usage' | 'team';
export const AdminLayout = ({ children, view, navigate, search, guest = false, connected = false }: {
 children: ReactNode; view: View; navigate: (view: View) => void; search: () => void; guest?: boolean; connected?: boolean;
}) => {
 const {preferences,set}=useAppearance();
 return <SidebarProvider className="reptest-shell" open={!preferences.collapsed} onOpenChange={open=>set({collapsed:!open})} style={{"--sidebar-width": "248px"} as CSSProperties}>
 <a className="skip-link" href="#workspace">Skip to workspace</a>
 <DemoAdminSidebar view={view} navigate={navigate} guest={guest} connected={connected} search={search}/>
 <SidebarInset className="min-w-0">
  <Topbar navigate={navigate} view={view} search={search} guest={guest} connected={connected}/>
  <div id="workspace" tabIndex={-1} className={'reptest-workspace flex min-w-0 flex-1 flex-col p-4 sm:p-5'+(view==='connections'?' configuration-workspace':'')}>
   {view==='connections'&&preferences.ambient&&preferences.motion&&<div className="configuration-background" aria-hidden="true"><Suspense fallback={null}>
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
  <div className="reptest-footer px-5"><Footer/></div>
  <nav className="reptest-phone-nav" aria-label="Phone navigation">{primaryViews.map(item=><button key={item.id} aria-current={(item.id==='overview'?workViews.includes(view):view===item.id)?'page':undefined} onClick={()=>navigate(item.id)}><item.icon/><span>{item.label}</span></button>)}</nav>
 </SidebarInset>
</SidebarProvider>;
};
