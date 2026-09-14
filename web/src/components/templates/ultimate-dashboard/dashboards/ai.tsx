// PaceUI Ultimate Dashboard AI layout, adapted to Repro Relay's persisted workspace data.
import { BookOpen, Inbox, ShieldCheck, FileCheck2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Chart19 } from '@/components/blocks/dashboard/chart/chart-19';
import { Stat13 } from '@/components/blocks/dashboard/stat/stat-13';
import { Card, CardContent } from '@/components/ui/card';
import type { Case, Memory } from '@/types';
import type { View } from '../layouts';
import { InvestigationDesk } from '@/components/InvestigationDesk';
const Chart18=lazy(()=>import('@/components/blocks/dashboard/chart/chart-18').then(module=>({default:module.Chart18})));
export function AIDashboard({cases,memories,guest,navigate,triage}:{cases:Case[];memories:Memory[];guest:boolean;navigate:(v:View)=>void;triage:(status:string)=>void}) {
 const stats=[
  {icon:Inbox,title:'Reported cases',value:cases.length,secondaryText:'Reports in this workspace'},
  {icon:ShieldCheck,title:'Recorded reproductions',value:cases.filter(c=>c.status==='reproduced').length,secondaryText:'Human observations with evidence'},
  {icon:BookOpen,title:'Reviewed memories',value:memories.length,secondaryText:'Source-linked observations'},
  {icon:FileCheck2,title:'Saved handoffs',value:cases.reduce((n,c)=>n+c.handoffs.length,0),secondaryText:'Snapshots retained for review'},
 ];
 return <div>
  <InvestigationDesk cases={cases} triage={triage}/>
  <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">{stats.map(stat=><Stat13 {...stat} trendValue="" key={stat.title}/>)}</div>
  <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-5"><div className="min-w-0 xl:col-span-3"><Suspense fallback={<Card className="h-full min-h-80"><CardContent role="status">Loading investigation activity…</CardContent></Card>}><Chart18 cases={cases}/></Suspense></div><div className="xl:col-span-2"><Chart19 guest={guest} open={()=>navigate('agents')}/></div></div>

 </div>
}
