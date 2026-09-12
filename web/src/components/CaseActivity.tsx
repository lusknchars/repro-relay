import { BookOpen, FileCheck2, FilePlus2, GitCommitHorizontal, RefreshCw, Search, ShieldAlert, ShieldCheck, CircleDot } from 'lucide-react'
import {
  Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator,
  TimelineItem, TimelineSeparator, TimelineTitle,
} from './ui/timeline'
import type { Case } from '../types'

const eventTypes = {
  'report.created': {title:'Report captured', icon:FilePlus2, tone:'neutral'},
  'observation.recorded': {title:'Observation recorded', icon:Search, tone:'neutral'},
  'memory.reviewed': {title:'Memory reviewed', icon:BookOpen, tone:'neutral'},
  'memory.revoked': {title:'Memory removed from retrieval', icon:BookOpen, tone:'warning'},
  'build.changed': {title:'Build changed', icon:GitCommitHorizontal, tone:'warning'},
  'worker.reassigned': {title:'Worker reassigned', icon:RefreshCw, tone:'warning'},
  'handoff.prepared': {title:'Handoff prepared', icon:FileCheck2, tone:'neutral'},
  'handoff.checked': {title:'Freshness check passed', icon:ShieldCheck, tone:'success'},
  'handoff.rejected': {title:'Outdated handoff rejected', icon:ShieldAlert, tone:'warning'},
}

export function CaseActivity({events}: {events:Case['events']}) {
  return <section className="case-activity" aria-label="Recorded activity">
    <div className="activity-heading"><div><h3>The case, as it happened.</h3><p>Recorded events, newest first. Original evidence stays attached.</p></div><span>{events.length} events</span></div>
    {!events.length && <p className="muted-paragraph">No events recorded for this case.</p>}
    <Timeline className="activity-timeline" value={events.length} role="list" aria-label="Case activity">
      {[...events].reverse().map((event,index)=>{
        const {title,icon:Icon,tone}=eventTypes[event.kind as keyof typeof eventTypes] || {title:event.kind.replaceAll('.',' ').replaceAll('_',' '),icon:CircleDot,tone:'neutral'}
        return <TimelineItem key={event.id} step={index+1} role="listitem" data-tone={tone}>
          <TimelineSeparator/>
          <TimelineIndicator><Icon size={15}/></TimelineIndicator>
          <TimelineHeader><TimelineDate dateTime={event.at}>{new Date(event.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</TimelineDate>{index===0&&<span className="activity-latest">Latest</span>}</TimelineHeader>
          <TimelineTitle>{title}</TimelineTitle>
          <TimelineContent><p>{event.detail}</p><details className="activity-source"><summary>Event source</summary><dl><div><dt>Event ID</dt><dd>{event.id}</dd></div><div><dt>Case revision</dt><dd>{event.case_revision}</dd></div></dl></details></TimelineContent>
        </TimelineItem>
      })}
    </Timeline>
  </section>
}
