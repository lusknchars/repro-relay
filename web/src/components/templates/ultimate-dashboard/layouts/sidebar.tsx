// Adapted from PaceUI Ultimate Dashboard sidebar.
import { lazy, Suspense } from 'react';
import { Bot, GitBranch, LayoutDashboard, Inbox, BookOpen, FileCheck2, Settings2, CircleDot } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import type { View } from './index';
const AsciiWaves=lazy(()=>import('@/components/react-bits/ascii-waves'));
const items: {id: View; label: string; icon: typeof Bot}[] = [
 {id:'overview',label:'Overview',icon:LayoutDashboard},
 {id:'inbox',label:'Case inbox',icon:Inbox},
 {id:'agents',label:'Agent controls',icon:Bot},
 {id:'memory',label:'Project memory',icon:BookOpen},
 {id:'handoffs',label:'Handoffs',icon:FileCheck2},
 {id:'connections',label:'Connections',icon:Settings2},
];
export function DemoAdminSidebar({view,navigate,guest,connected}: {view:View;navigate:(view:View)=>void;guest:boolean;connected:boolean}) {
 const {setOpenMobile,open,openMobile,isMobile}=useSidebar();
 function go(next:View){navigate(next);setOpenMobile(false)}
 return <Sidebar>
  <div className="relay-sidebar-body">
  {(isMobile?openMobile:open)&&<Suspense fallback={null}><AsciiWaves/></Suspense>}
  <SidebarHeader className="flex-row items-center gap-2.5 p-4">
   <button onClick={()=>go('overview')} className="flex items-center gap-2.5" aria-label="Repro Relay overview">
    <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md"><GitBranch className="size-4.5"/></span>
    <span className="text-xl font-semibold tracking-tight">Repro Relay</span>
   </button>
  </SidebarHeader>
  <SidebarContent><nav aria-label="Workspace"><SidebarMenu className="mt-2 mb-2 gap-0.5 px-2">
   <SidebarMenuItem className="text-muted-foreground mb-2 px-2 text-xs font-medium uppercase tracking-wide">Workspace</SidebarMenuItem>
   {items.map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view===item.id} aria-current={view===item.id?'page':undefined} onClick={()=>go(item.id)} className="h-11 px-2.5 py-2 md:h-9">
    <item.icon/><span>{item.label}</span>
   </SidebarMenuButton></SidebarMenuItem>)}
  </SidebarMenu></nav></SidebarContent>
  <SidebarFooter className="border-t p-3">
   <div className="flex items-center gap-2.5 rounded-md px-1 py-2">
    <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full"><GitBranch className="size-4"/></div>
    <div className="min-w-0"><p className="text-sm font-medium">{guest?'Guest workspace':'Local workspace'}</p><p className="text-muted-foreground flex items-center gap-1 text-xs"><CircleDot className="size-3"/>{connected?'Workspace connected':'Connecting…'}</p></div>
   </div>
  </SidebarFooter>
  </div>
 </Sidebar>
}
