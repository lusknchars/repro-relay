// PaceUI Ultimate Dashboard AI layout, adapted to Repro Relay's persisted workspace data.
import { lazy, Suspense } from 'react';
import { Chart19 } from '@/components/blocks/dashboard/chart/chart-19';
import { Card, CardContent } from '@/components/ui/card';
import type { Case } from '@/types';
import type { View } from '../layouts';
const Chart18=lazy(()=>import('@/components/blocks/dashboard/chart/chart-18').then(module=>({default:module.Chart18})));
export function AIDashboard({cases,guest,navigate}:{cases:Case[];guest:boolean;navigate:(v:View)=>void}) {
 return <div>
  <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 xl:grid-cols-5"><div className="min-w-0 xl:col-span-3"><Suspense fallback={<Card className="h-full min-h-80"><CardContent role="status">Loading investigation activity…</CardContent></Card>}><Chart18 cases={cases}/></Suspense></div><div className="xl:col-span-2"><Chart19 guest={guest} open={()=>navigate('agents')}/></div></div>

 </div>
}
