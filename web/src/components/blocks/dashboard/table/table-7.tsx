// Adapted from PaceUI Ultimate Dashboard's trace table; real Relay cases replace synthetic traces.
import { useEffect, useState, type RefObject } from 'react';
import { Search, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { Case } from '@/types';
const names:Record<string,string>={new:'New report',reproduced:'Reproduced',not_reproduced:'Not reproduced',needs_context:'Needs context',blocked:'Blocked'};
export function Table7({cases,open,query,setQuery,filter,setFilter,searchRef,compact=false}:{
 cases:Case[];open:(item:Case)=>void;query:string;setQuery:(value:string)=>void;filter:string;setFilter:(value:string)=>void;searchRef?:RefObject<HTMLInputElement|null>;compact?:boolean;
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
    <div className="relative min-w-0 flex-1 sm:max-w-xs"><Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4"/><Input ref={searchRef} aria-label="Search cases" className="pl-9" placeholder="Find a case…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <select aria-label="Filter cases by status" className="filter-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
   </div>
   <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Project</TableHead><TableHead>Status</TableHead><TableHead>Build</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
    <TableBody>{rows.length?rows.map(item=><TableRow key={item.id}>
     <TableCell className="max-w-xs whitespace-normal"><button className="case-row text-left" onClick={()=>open(item)}><span className="block text-sm font-medium hover:underline">{item.title}</span><span className="text-muted-foreground mt-1 block font-mono text-xs">{item.id}</span></button></TableCell>
     <TableCell>{item.project}</TableCell><TableCell><Badge variant="outline" className={'status '+item.status}>{names[item.status]}</Badge></TableCell>
     <TableCell><code className="text-xs">{item.build||'Not supplied'}</code></TableCell><TableCell className="text-muted-foreground text-xs">{new Date(item.updated_at).toLocaleDateString()}</TableCell>
     <TableCell className="text-right"><Button variant="ghost" size="icon-sm" aria-label={'Open '+item.title} onClick={()=>open(item)}><ArrowUpRight/></Button></TableCell>
    </TableRow>):<TableRow><TableCell colSpan={6} className="text-muted-foreground h-28 text-center">{cases.length?'No matching cases. Try another search.':'No cases yet. Create a report to begin.'}</TableCell></TableRow>}</TableBody>
   </Table>
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-muted-foreground text-xs">{found.length} {found.length===1?'case':'cases'} · Page {current+1} of {pages}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={current===0} onClick={()=>setPage(current-1)} aria-label="Previous cases"><ChevronLeft/></Button><Button variant="outline" size="sm" disabled={current>=pages-1} onClick={()=>setPage(current+1)} aria-label="Next cases"><ChevronRight/></Button></div></div>
  </CardContent>
 </Card>
}
