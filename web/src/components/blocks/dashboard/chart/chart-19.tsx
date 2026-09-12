// Adapted from the selected PaceUI template's Chart19 card.
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import hermesLogo from '@/assets/hermes-logo.webp';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export function Chart19({guest,open}:{guest:boolean;open:()=>void}) {
 return <Card className="h-full gap-4 py-5">
  <CardHeader className="px-5"><CardTitle>Investigator control</CardTitle><CardDescription>One agent. A continuous case history.</CardDescription></CardHeader>
  <CardContent className="flex flex-1 flex-col px-5">
   <div className="bg-muted/50 mb-5 flex items-center gap-3 rounded-lg border p-4"><img src={hermesLogo} alt="" width={44} height={44} className="size-11 shrink-0 rounded-lg border bg-white object-contain"/><div><p className="text-sm font-medium">Hermes investigator</p><p className="text-muted-foreground mt-1 text-xs">{guest?'Disabled in guest workspaces':'Connect your dedicated runtime'}</p></div></div>
   <ul className="text-muted-foreground space-y-3 text-sm"><li>Start from the current build and reviewed context.</li><li>Track the run and request a stop when needed.</li><li>Review proposals before publishing evidence.</li></ul>
   <div className="mt-auto pt-5"><Button variant="outline" className="w-full justify-between" onClick={open}>Open agent controls<ArrowUpRight className="size-4"/></Button><p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs"><ShieldCheck className="size-3.5 shrink-0"/>Runtime permissions control tool access.</p></div>
  </CardContent>
 </Card>
}
