// Adapted from the selected PaceUI template's Chart18 card.
import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { Case } from '@/types';
export function Chart18({cases}:{cases:Case[]}) {
 const data=useMemo(()=>Array.from({length:14},(_,i)=>{
  const day=new Date();day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()-13+i);
  const date=day.toISOString().slice(0,10);
  return {date,Reports:cases.filter(c=>c.created_at.slice(0,10)===date).length,Observations:cases.flatMap(c=>c.observations).filter(o=>o.at.slice(0,10)===date).length};
 }),[cases]);
 return <Card className="h-full gap-4 py-5">
  <CardHeader className="px-5"><CardTitle>Investigation activity</CardTitle><CardDescription>Reports and recorded observations · last 14 days, UTC</CardDescription></CardHeader>
  <CardContent className="px-5">
   <div className="mb-4 flex flex-wrap gap-5 text-xs"><span><i className="chart-key bg-primary"/>Reports</span><span><i className="chart-key bg-emerald-500"/>Recorded observations</span></div>
   <div className="h-56 min-w-0" role="img" aria-label={data.reduce((s,d)=>s+d.Reports,0)+' reports and '+data.reduce((s,d)=>s+d.Observations,0)+' observations in the last 14 days'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:400,height:224}}>
     <AreaChart data={data} margin={{top:8,right:4,left:-25,bottom:0}}>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3"/>
      <XAxis dataKey="date" tickFormatter={value=>String(value).slice(5)} axisLine={false} tickLine={false} minTickGap={28} tick={{fontSize:11,fill:'var(--muted)'}}/>
      <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'var(--muted)'}}/>
      <Tooltip contentStyle={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
      <Area type="monotone" dataKey="Reports" stroke="var(--brand)" fill="var(--brand)" fillOpacity={.12} strokeWidth={2} isAnimationActive={false}/>
      <Area type="monotone" dataKey="Observations" stroke="#10b981" fill="#10b981" fillOpacity={.06} strokeWidth={2} isAnimationActive={false}/>
     </AreaChart>
    </ResponsiveContainer>
   </div>
   <p className="text-muted-foreground mt-3 text-xs">Observation counts reflect team records, not independent verification.</p>
  </CardContent>
 </Card>
}
