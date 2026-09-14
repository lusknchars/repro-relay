// PaceUI Ultimate Dashboard AI layout, adapted to Repro Relay's persisted workspace data.
import { BookOpen, Inbox, ShieldCheck, FileCheck2, ArrowUpRight } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Chart19 } from '@/components/blocks/dashboard/chart/chart-19';
import { Stat13 } from '@/components/blocks/dashboard/stat/stat-13';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Case, Memory } from '@/types';
import type { View } from '../layouts';
const Chart18=lazy(()=>import('@/components/blocks/dashboard/chart/chart-18').then(module=>({default:module.Chart18})));
export function AIDashboard({cases,memories,guest,navigate}:{cases:Case[];memories:Memory[];guest:boolean;navigate:(v:View)=>void}) {
 const stats=[
  {icon:Inbox,title:'Reported cases',value:cases.length,secondaryText:'Reports in this workspace'},
  {icon:ShieldCheck,title:'Recorded reproductions',value:cases.filter(c=>c.status==='reproduced').length,secondaryText:'Human observations with evidence'},
  {icon:BookOpen,title:'Reviewed memories',value:memories.length,secondaryText:'Source-linked observations'},
  {icon:FileCheck2,title:'Saved handoffs',value:cases.reduce((n,c)=>n+c.handoffs.length,0),secondaryText:'Snapshots retained for review'},
 ];
 return <div>
  <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">{stats.map(stat=><Stat13 {...stat} trendValue="" key={stat.title}/>)}</div>
  <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-5"><div className="min-w-0 xl:col-span-3"><Suspense fallback={<Card className="h-full min-h-80"><CardContent role="status">Loading investigation activity…</CardContent></Card>}><Chart18 cases={cases}/></Suspense></div><div className="xl:col-span-2"><Chart19 guest={guest} open={()=>navigate('agents')}/></div></div>
  <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-3">{[
   {view:'inbox' as const,title:'Pick up an investigation',detail:cases.filter(c=>['new','needs_context','blocked'].includes(c.status)).length+' cases awaiting more evidence.',icon:Inbox},
   {view:'memory' as const,title:'Use reviewed context',detail:'Inspect evidence before carrying it into another case.',icon:BookOpen},
   {view:'handoffs' as const,title:'Prepare the next step',detail:'Check build and assignment freshness before a handoff.',icon:FileCheck2},
  ].map(item=><Card key={item.view} className="relay-card-action py-5"><CardContent className="px-5"><item.icon className="mb-3 size-5 text-muted-foreground"/><h2 className="text-sm font-medium">{item.title}</h2><p className="text-muted-foreground mt-2 text-xs">{item.detail}</p><Button variant="link" className="mt-3 h-auto px-0" onClick={()=>navigate(item.view)}>Open workspace<ArrowUpRight/></Button></CardContent></Card>)}</div>
 </div>
}
