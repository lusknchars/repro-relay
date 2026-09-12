import { useRef, useState } from 'react';
import { ArrowRight, GitBranch, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { AdminLayout } from './templates/ultimate-dashboard/layouts';
import { PageTitle } from './templates/ultimate-dashboard/layouts/page-title';
import { message, request } from '../lib/api';

export function GuestGate({ready}:{ready:()=>Promise<void>}) {
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const pending=useRef(false);
 async function start(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{await request('/session',{method:'POST',body:'{}'});await ready()}
  catch(e){setError(message(e))}
  finally{pending.current=false;setBusy(false)}
 }
 return <AdminLayout view="overview" navigate={()=>void start()} search={()=>void start()} guest>
  <PageTitle title="Welcome to Repro Relay" description="An investigation workspace for your team and its agents."/>
  <Card className="mt-5 max-w-3xl">
   <CardHeader><GitBranch className="mb-3 size-8 text-primary"/><CardTitle><h2 className="text-2xl font-semibold">Start with a report. Keep the evidence.</h2></CardTitle><CardDescription>Try the report, reviewed-memory, and engineering-handoff workflow in your own guest workspace.</CardDescription></CardHeader>
   <CardContent><Button size="lg" pending={busy} onClick={()=>void start()}>{busy?'Opening your workspace…':'Try a test workspace'}<ArrowRight/></Button>
    <p className="text-muted-foreground mt-5 flex items-start gap-2 text-sm"><ShieldCheck className="size-4 shrink-0"/>Includes an explicitly labeled sample report. Guest workspaces cannot start a connected agent.</p>
    <p className="text-muted-foreground mt-3 text-xs leading-relaxed">Use sample data. Your workspace expires after seven days. Clearing cookies loses access. Maintainers can review test records and feedback.</p>
    {error&&<p className="form-error mt-4" role="alert">{error}</p>}
   </CardContent>
  </Card>
 </AdminLayout>
}
