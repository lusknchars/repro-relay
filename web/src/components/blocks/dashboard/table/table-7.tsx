// Adapted from PaceUI Ultimate Dashboard's trace table; real Relay cases replace synthetic traces.
import { useEffect, useState, type RefObject } from 'react';
import { Search, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { Case } from '@/types';
import { caseGuidance } from '@/lib/workspace-guidance';
const names:Record<string,string>={new:'New report',reproduced:'Reproduced',not_reproduced:'Not reproduced',needs_context:'Needs context',blocked:'Blocked'};
export function Table7({cases,open,investigate,query,setQuery,filter,setFilter,searchRef,compact=false}:{
 cases:Case[];open:(item:Case)=>void;investigate:(item:Case)=>void;query:string;setQuery:(value:string)=>void;filter:string;setFilter:(value:string)=>void;searchRef?:RefObject<HTMLInputElement|null>;compact?:boolean;
}) {
 const [page,setPage]=useState(0);
 useEffect(()=>setPage(0),[query,filter,cases.length]);
 const found=cases.filter(c=>(filter==='all'||c.status===filter)&&(c.title+' '+c.project+' '+c.id).toLowerCase().includes(query.toLowerCase()));
 const pages=Math.max(1,Math.ceil(found.length/8));
 const current=Math.min(page,pages-1);
 const rows=found.slice(current*8,current*8+8);
 return <Card className="gap-4 py-5" aria-label="Cases" role="region">
  <CardHeader className="px-5"><CardTitle>{compact?'Recent cases':'Case inbox'}</CardTitle><CardDescription>Reports, source builds, and the next investigation step.</CardDescription></CardHeader>
  <CardContent className="min-w-0 px-5">
   <div className="mb-4 flex flex-wrap items-center gap-3">
    <div className="relative min-w-0 flex-1 sm:max-w-xs"><Search className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 size-4"/><Input ref={searchRef} aria-label="Search cases" className="min-h-11 pl-9" placeholder="Find a case…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <select aria-label="Filter cases by status" className="filter-select min-h-11" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
   </div>
   {filter !== 'all' && <p className="mb-4 text-sm leading-6 text-muted-foreground">{caseGuidance[filter as Case['status']]?.next} <Button variant="link" className="min-h-11" onClick={()=>setFilter('all')}>Show all statuses</Button></p>}
   <Table><TableHeader><TableRow><TableHead>Report / next step</TableHead><TableHead className="max-lg:hidden">Project</TableHead><TableHead className="max-sm:hidden">Status</TableHead><TableHead className="max-lg:hidden">Build</TableHead><TableHead className="max-lg:hidden">Updated</TableHead><TableHead className="max-sm:hidden text-right">Action</TableHead></TableRow></TableHeader>
    <TableBody>{rows.length?rows.map(item=><TableRow key={item.id}>
     <TableCell className="max-w-xs whitespace-normal"><button className="case-row min-h-11 text-left" onClick={()=>open(item)}><span className="block text-sm font-medium hover:underline">{item.title}</span><span className="text-muted-foreground mt-1 hidden break-all font-mono text-xs sm:block">{item.id}</span></button><p className="mt-2 text-xs leading-5 text-muted-foreground">{caseGuidance[item.status].next}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:hidden"><Badge variant="outline" className={'status '+item.status}>{names[item.status]}</Badge><Button variant="outline" className="min-h-11" aria-label={'View investigation for '+item.title} onClick={()=>investigate(item)}>Investigation</Button></div></TableCell>
     <TableCell className="max-lg:hidden">{item.project}</TableCell><TableCell className="max-sm:hidden"><Badge variant="outline" className={'status '+item.status}>{names[item.status]}</Badge></TableCell>
     <TableCell className="max-lg:hidden"><code className="text-xs">{item.build||'Not supplied'}</code></TableCell><TableCell className="max-lg:hidden text-muted-foreground text-xs">{new Date(item.updated_at).toLocaleDateString()}</TableCell>
     <TableCell className="max-sm:hidden text-right"><div className="flex flex-wrap justify-end gap-1"><Button variant="outline" className="min-h-11" aria-label={'View investigation for '+item.title} onClick={()=>investigate(item)}>Investigation</Button><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={'Open '+item.title} onClick={()=>open(item)}><ArrowUpRight/></Button></div></TableCell>
    </TableRow>):<TableRow><TableCell colSpan={6} className="text-muted-foreground h-28 text-center">{cases.length?'No matching cases. Try another search.':'No cases yet. Create a report to begin.'}</TableCell></TableRow>}</TableBody>
   </Table>
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-muted-foreground text-xs" role="status">{found.length} {found.length===1?'case':'cases'} · Page {current+1} of {pages}</p><div className="flex gap-2"><Button variant="outline" className="min-h-11 min-w-11" size="sm" disabled={current===0} onClick={()=>setPage(current-1)} aria-label="Previous cases"><ChevronLeft/></Button><Button variant="outline" className="min-h-11 min-w-11" size="sm" disabled={current>=pages-1} onClick={()=>setPage(current+1)} aria-label="Next cases"><ChevronRight/></Button></div></div>
  </CardContent>
 </Card>
}
