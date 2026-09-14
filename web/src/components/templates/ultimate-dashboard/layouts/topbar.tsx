import { AccountControl } from '@/components/AccountControl';
// Adapted from PaceUI Ultimate Dashboard topbar.
import { Command, Search, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { AppearanceControl } from '@/components/reptest/Appearance';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { View } from './index';
export function Topbar({view,search,guest,navigate,connected}:{view:View;search:()=>void;guest:boolean;navigate:(view:View)=>void;connected:boolean}) {
 return <header className="reptest-topbar bg-background/95 sticky top-0 z-30 flex min-h-14 items-center justify-between border-b backdrop-blur-sm">
  <div className="flex items-center gap-2 px-4"><SidebarTrigger/><span className="text-xs font-medium max-sm:hidden">{guest?'Guest':'Local workspace'}<span className="mx-2 text-muted-foreground">/</span>Repro Relay</span>
   <Button variant="outline" size="sm" className="w-44 justify-between shadow-none max-xl:hidden" onClick={search}>
    <span className="text-muted-foreground font-normal">Find a case…</span>
    <span className="flex items-center gap-1" aria-hidden="true"><kbd className="bg-background flex size-5 items-center justify-center rounded border"><Command className="size-2.5"/></kbd><kbd className="bg-background flex size-5 items-center justify-center rounded border text-[10px]">K</kbd></span>
   </Button>
   <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Find a case" onClick={search}><Search className="size-4"/></Button>
  </div>
  <div className="flex items-center gap-2 px-4"><Button variant="ghost" size="sm" className="max-md:hidden" onClick={()=>navigate('connections')}><Bot className="size-4"/>{connected?'Local API ready':'Check connection'}</Button><ThemeToggle/><AppearanceControl/>{!guest && <AccountControl navigate={navigate} returnTo={(() => {const p=new URLSearchParams();p.set('view',view);const c=new URLSearchParams(window.location.search).get('case');if(c && ['agents','inbox','usage'].includes(view))p.set('case',c);const a=new URLSearchParams(window.location.search).get('audit');if(a && view==='sessions')p.set('audit',a);return '/?'+p.toString()})()}/>}</div>
 </header>
}
