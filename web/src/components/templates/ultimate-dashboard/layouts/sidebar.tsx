// PaceUI primitives, recomposed from the user-supplied reptest shell.
import { lazy, Suspense } from 'react'
import { Bot, GitBranch, LayoutDashboard, Inbox, BookOpen, FileCheck2, Settings2, CircleDot, MessageSquare, Users, Gauge, PanelLeft, Search } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import type { View } from './index'
import { workspaceGuidance } from '@/lib/workspace-guidance'
import { useAppearance } from '@/components/reptest/Appearance'
const AsciiWaves=lazy(()=>import('@/components/react-bits/ascii-waves'))
export const primaryViews: {id:View;label:string;icon:typeof Bot}[] = [
 {id:'overview',label:'Work',icon:Inbox}, {id:'team',label:'Team',icon:Users}, {id:'memory',label:'Knowledge',icon:BookOpen}, {id:'usage',label:'Usage',icon:Gauge}, {id:'connections',label:'Settings',icon:Settings2},
]
const tools: {id:View;label:string;icon:typeof Bot}[] = [
 {id:'overview',label:'Overview',icon:LayoutDashboard}, {id:'sessions',label:'Autonomous work',icon:MessageSquare}, {id:'inbox',label:'Case inbox',icon:Inbox}, {id:'agents',label:'Agent controls',icon:Bot}, {id:'handoffs',label:'Handoffs',icon:FileCheck2},
]
export const workViews:View[]=['overview','sessions','inbox','agents','handoffs']
export function DemoAdminSidebar({view,navigate,guest,connected,search}: {view:View;navigate:(view:View)=>void;guest:boolean;connected:boolean;search:()=>void}) {
 const {setOpenMobile,open,openMobile,isMobile,toggleSidebar}=useSidebar()
 const {preferences}=useAppearance()
 function go(next:View){navigate(next);setOpenMobile(false)}
 return <Sidebar variant={preferences.sidebar} collapsible="icon" className="reptest-sidebar">
  <div className="relay-sidebar-body">
  {preferences.ambient&&preferences.motion&&(isMobile?openMobile:open)&&<Suspense fallback={null}><AsciiWaves/></Suspense>}
  <SidebarHeader className="flex-row items-center gap-2 p-3">
   <button onClick={()=>go('overview')} className="flex min-h-11 items-center gap-2" aria-label="Repro Relay overview"><span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md"><GitBranch className="size-4"/></span><span className="reptest-sidebar-label text-sm font-semibold">Repro Relay</span></button>
  </SidebarHeader>
  <SidebarContent>
   <div className="px-2"><button onClick={()=>{search();setOpenMobile(false)}} className="reptest-sidebar-search" aria-label="Find a case"><Search className="size-4 shrink-0"/><span className="reptest-sidebar-label flex-1 text-left">Search work, evidence…</span><kbd className="reptest-sidebar-label">⌘K</kbd></button></div>
   <nav aria-label="Workspace"><SidebarMenu className="mt-3 gap-0.5 px-2">
    {primaryViews.map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton tooltip={item.label} aria-label={item.label} isActive={item.id==='overview'?workViews.includes(view):view===item.id} aria-current={(item.id==='overview'?workViews.includes(view):view===item.id)?'page':undefined} onClick={()=>go(item.id)} className="min-h-11 px-2.5"><item.icon/><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}
    <SidebarMenuItem className="reptest-sidebar-label mt-5 mb-1 px-2.5 text-xs text-muted-foreground">Work views</SidebarMenuItem>
    {tools.map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton tooltip={item.label} aria-label={item.label} isActive={view===item.id} aria-current={view===item.id?'page':undefined} aria-describedby={`nav-purpose-${item.id}`} onClick={()=>go(item.id)} className="reptest-work-link min-h-11 px-2.5"><item.icon/><span>{item.label}</span><span className="sr-only" id={`nav-purpose-${item.id}`}>{workspaceGuidance[item.id].short}</span></SidebarMenuButton></SidebarMenuItem>)}
   </SidebarMenu></nav>
  </SidebarContent>
  <SidebarFooter className="border-t p-2"><div className="reptest-sidebar-label px-2 py-3 text-xs"><p className="font-medium">{guest?'Guest workspace':'Local workspace'}</p><p className="mt-1 flex items-center gap-1.5 text-muted-foreground"><CircleDot className="size-3"/>{connected?'Workspace connected':'Connection unavailable'}</p></div><SidebarMenuButton onClick={toggleSidebar} tooltip={open?'Collapse sidebar':'Expand sidebar'} aria-label={open?'Collapse sidebar':'Expand sidebar'} className="min-h-11 justify-center"><PanelLeft/><span>{open?'Collapse':'Expand'}</span></SidebarMenuButton></SidebarFooter>
  </div>
 </Sidebar>
}
