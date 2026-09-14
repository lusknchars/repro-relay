import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronRight, ClipboardList, FileText, History, Play, Plus, RefreshCw, Search, ShieldCheck, Square } from 'lucide-react'
import hermesLogo from '../assets/hermes-logo.webp'
import type { Case, InvestigationRun } from '../types'
import { message, request } from '../lib/api'
import { InvestigationRequestError, isRunActive, reviewLabels, runLabels, submitInvestigationRequest } from '../lib/investigation'
import type { InvestigationPreview, PendingInvestigationRequest, ReviewDraft, RunReview } from '../lib/investigation'
import { Button } from './ui/button'
import { ApprovalButton, type ApprovalState } from './ui/approval-button'
import { InvestigationEvidence } from './InvestigationEvidence'
import { InvestigationCost } from './InvestigationCost'
import './investigation-workspace.css'

type Props = {
  cases: Case[]; selectedId: string; onSelect: (id: string) => void; guest: boolean;
  onOpenCase: (item: Case) => void; onNewReport: () => void;
  onRefresh?: () => Promise<void>;
}
type Session = {
  drafts: Map<string, ReviewDraft>; pending: Map<string, PendingInvestigationRequest>; selectedRuns: Map<string, string>;
}
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const humanStatus: Record<string, string> = { new: 'New report', reproduced: 'Human reproduced', not_reproduced: 'Not reproduced', blocked: 'Blocked', needs_context: 'Needs context' }
function safeEvidenceUrl(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
function contextCounts(context: unknown) {
  const value = context && typeof context === 'object' ? context as Record<string, unknown> : {}
  return {
    events: Array.isArray(value.source_event_ids) ? value.source_event_ids.length : 0,
    memories: Array.isArray(value.related_reviewed_observations) ? value.related_reviewed_observations.length : 0,
  }
}
function inspectorName(context: unknown) {
  if (!context || typeof context !== 'object' || !('inspection' in context)) return 'named local inspector'
  const inspection = context.inspection
  if (!inspection || typeof inspection !== 'object' || !('inspector' in inspection)) return 'named local inspector'
  return typeof inspection.inspector === 'string' && inspection.inspector.trim() ? inspection.inspector : 'named local inspector'
}
function savedRun(caseId: string) {
  try { return window.localStorage.getItem(`relay-investigation-selection:${caseId}`) || '' } catch { return '' }
}

export function InvestigationWorkspace({ cases, selectedId, onSelect, guest, onOpenCase, onNewReport, onRefresh }: Props) {
  const [search, setSearch] = useState('')
  const session = useRef<Session>({ drafts: new Map(), pending: new Map(), selectedRuns: new Map() })
  const selected = cases.find(item => item.id === selectedId) ?? cases[0]
  const matches = cases.filter(item => `${item.title} ${item.project} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim()))
  return <section className="investigation-workspace" aria-label="Investigation workspace">
    <aside className="iw-inbox" aria-label="Investigation cases">
      <div className="iw-inbox-heading"><div><span className="iw-eyebrow">CASE WORKSPACE</span><h2>Investigations <span>{cases.length}</span></h2></div><Button variant="outline" size="icon" aria-label="New investigation report" onClick={onNewReport}><Plus /></Button></div>
      <label className="iw-search"><Search aria-hidden="true" /><input aria-label="Search investigation cases" placeholder="Find a reported problem…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="iw-case-list">{matches.map(item => <button key={item.id} className={`iw-case ${selected?.id === item.id ? 'iw-selected' : ''}`} aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => onSelect(item.id)}>
        <span className="iw-case-project">{item.project || 'Workspace'}</span><strong>{item.title}</strong><span className="iw-case-meta"><span>{humanStatus[item.status] || item.status}</span><ChevronRight aria-hidden="true" /></span>
      </button>)}</div>
      {!matches.length && <p className="iw-empty">{cases.length ? 'No reports match your search.' : 'Create a report to give Hermes a problem to investigate.'}</p>}
      <div className="iw-inbox-foot"><ShieldCheck aria-hidden="true" /><span>Case history stays attached to every investigation.</span></div>
    </aside>
    {selected ? <CaseInvestigation key={selected.id} item={selected} guest={guest} onOpenCase={onOpenCase} session={session.current} onRefresh={onRefresh} /> : <div className="iw-welcome"><ClipboardList aria-hidden="true" /><h2>Start with a reported problem</h2><p>Describe what happened and what you expected. Review the investigation, its source context, and your next action together here.</p><Button onClick={onNewReport}><Plus />New report</Button></div>}
  </section>
}

function CaseInvestigation({ item, guest, onOpenCase, session, onRefresh }: { item: Case; guest: boolean; onOpenCase: (item: Case) => void; session: Session; onRefresh?: () => Promise<void> }) {
  const [runs, setRuns] = useState<InvestigationRun[]>([])
  const [reviews, setReviews] = useState<RunReview[]>([])
  const [runner, setRunner] = useState<{ available: boolean; reason: string } | null>(null)
  const [runId, setRunId] = useState(session.selectedRuns.get(item.id) || savedRun(item.id))
  const [loaded, setLoaded] = useState(false)
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState(session.pending.get(item.id))
  const [maxSeconds, setMaxSeconds] = useState(120)
  const [preview, setPreview] = useState<InvestigationPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewGeneration, setPreviewGeneration] = useState(0)
  const [excludedReviewId, setExcludedReviewId] = useState<string | null>(null)
  const [, setDraftVersion] = useState(0)
  const [reviewState, setReviewState] = useState<{ id: string; state: ApprovalState } | null>(null)
  const alive = useRef(true)
  const mutating = useRef(false)
  const generation = useRef(0)
  const current = runs.find(run => run.id === runId) ?? runs[0]
  const localValidation = current?.execution_kind === 'local_validation'
  const currentReviews = reviews.filter(review => review.run_id === current?.id)
  const latestReview = currentReviews[0]
  const followUpReviewId = latestReview?.decision === 'needs_changes' && latestReview.id !== excludedReviewId ? latestReview.id : null
  const activeRun = runs.find(run => isRunActive(run.status))
  const stale = !!current && (current.context_stale || current.case_revision !== item.revision || current.owner_version !== item.owner_version || current.build !== item.build)
  const reviewable = !!current?.output?.trim() && !isRunActive(current.status) && !stale && !guest
  const draftKey = current?.id || item.id
  const draft = session.drafts.get(draftKey) ?? { reviewer: '', decision: 'needs_changes', feedback: '' }
  const previewCurrent = preview && preview.case_revision === item.revision && preview.owner_version === item.owner_version && preview.build === item.build && preview.follow_up_review_id === followUpReviewId
  const canStart = !guest && !!runner?.available && !activeRun && !!item.build.trim() && !!previewCurrent && !busy && !pending && loaded && !readError
  const counts = contextCounts(preview?.context)

  function selectRun(id: string) {
    setRunId(id); session.selectedRuns.set(item.id, id); setAnnouncement(''); setError('')
    try { window.localStorage.setItem(`relay-investigation-selection:${item.id}`, id) } catch { /* Selection still persists for this mounted workspace. */ }
  }
  function editDraft(patch: Partial<ReviewDraft>) { setReviewState(null); session.drafts.set(draftKey, { ...draft, ...patch }); setDraftVersion(version => version + 1) }

  async function refreshContext() {
    setPreview(null); setPreviewError('')
    try { await onRefresh?.(); if (alive.current) setPreviewGeneration(value => value + 1) }
    catch (reason) { if (alive.current) setPreviewError(message(reason)) }
  }

  async function refresh(signal?: AbortSignal) {
    const version = ++generation.current
    const [nextRuns, nextReviews] = await Promise.all([
      request<InvestigationRun[]>(`/cases/${item.id}/runs`, { signal }),
      request<RunReview[]>(`/cases/${item.id}/run-reviews`, { signal }),
    ])
    if (!alive.current || version !== generation.current) return
    setRuns(nextRuns); setReviews(nextReviews); setLoaded(true); setReadError('')
  }

  useEffect(() => {
    setAnnouncement('')
  }, [current?.id, current?.status])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function poll() {
      if (!mutating.current) {
        try { await refresh(controller.signal) } catch (reason) { if (!controller.signal.aborted) setReadError(message(reason)) }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    void poll()
    request<{ available: boolean; reason: string }>('/runner', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setRunner(value) })
      .catch(reason => { if (!controller.signal.aborted) setRunner({ available: false, reason: message(reason) }) })
    return () => { alive.current = false; controller.abort(); clearTimeout(timer); generation.current++ }
  // The component is keyed by case id. Changing builds does not discard its review draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  useEffect(() => {
    const controller = new AbortController()
    setPreview(null); setPreviewError('')
    const query = followUpReviewId ? `?review_id=${encodeURIComponent(followUpReviewId)}` : ''
    request<InvestigationPreview>(`/cases/${item.id}/investigation-preview${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setPreview(value) })
      .catch(reason => { if (!controller.signal.aborted) setPreviewError(message(reason)) })
    return () => controller.abort()
  }, [item.id, item.revision, item.owner_version, item.build, followUpReviewId, previewGeneration])

  async function submit(action: PendingInvestigationRequest) {
    if (mutating.current) return
    mutating.current = true; generation.current++; setBusy(action.kind); setError(''); setAnnouncement('')
    session.pending.set(item.id, action); setPending(action)
    const reviewedRunId = action.kind === 'review' ? action.path.split('/')[2] : ''
    if (reviewedRunId) setReviewState({ id: reviewedRunId, state: 'loading' })
    try {
      const result = await submitInvestigationRequest<InvestigationRun | RunReview>(action)
      session.pending.delete(item.id)
      if (!alive.current) return
      setPending(undefined)
      if (reviewedRunId) setReviewState({ id: reviewedRunId, state: 'success' })
      if (action.kind === 'start') selectRun(result.id)
      setAnnouncement(action.kind === 'start' ? 'Investigation submitted to Hermes.' : 'Review saved. Case evidence and reviewed memory have not changed.')
      setPreviewGeneration(value => value + 1)
      try { await refresh() } catch (reason) { if (alive.current) setReadError(message(reason)) }
    } catch (reason) {
      const certain = reason instanceof InvestigationRequestError && reason.status >= 400 && reason.status < 500
      if (certain) session.pending.delete(item.id)
      if (!alive.current) return
      if (reviewedRunId) setReviewState({ id: reviewedRunId, state: 'error' })
      if (certain) {
        setPending(undefined)
        if (reason.status === 409) await refreshContext()
        else setPreviewGeneration(value => value + 1)
      }
      if (alive.current) setError(`${message(reason)}${certain ? ' Your draft is still available.' : ' The outcome is unknown. Retry this same request to check its saved result.'}`)
    } finally { mutating.current = false; if (alive.current) setBusy('') }
  }

  function start() {
    if (!canStart || !preview) return
    void submit({ key: crypto.randomUUID(), path: `/cases/${item.id}/runs`, kind: 'start', label: followUpReviewId ? 'follow-up investigation' : 'investigation', body: JSON.stringify({ revision: preview.case_revision, max_seconds: maxSeconds, follow_up_review_id: preview.follow_up_review_id, context_hash: preview.context_hash }) })
  }

  function saveReview(event: React.FormEvent) {
    event.preventDefault()
    if (!current || !reviewable || pending || busy || (reviewState?.id === current.id && reviewState.state === 'success')) return
    void submit({ key: crypto.randomUUID(), path: `/runs/${current.id}/reviews`, kind: 'review', label: 'proposal review', body: JSON.stringify({ case_revision: item.revision, run_version: current.version, reviewer: draft.reviewer.trim(), decision: draft.decision, feedback: draft.feedback.trim() }) })
  }

  async function runAction(action: 'stop' | 'reconcile' | 'connection') {
    if (mutating.current || pending) return
    mutating.current = true; generation.current++; setBusy(action); setError(''); setAnnouncement('')
    try {
      if (action === 'connection') {
        const value = await request<{ available: boolean; reason: string }>('/runner')
        if (alive.current) { setRunner(value); setAnnouncement(value.reason) }
      } else if (current) {
        await request(`/runs/${current.id}/${action}`, { method: 'POST' })
        if (alive.current) setAnnouncement(action === 'stop' ? 'Stop requested. Waiting for Hermes to confirm.' : 'Reconciliation requested.')
      }
      if (alive.current) await refresh()
    } catch (reason) { if (alive.current) setError(message(reason)) }
    finally { mutating.current = false; if (alive.current) setBusy('') }
  }

  return <>
    <section className="iw-investigation" aria-label="Agent investigation">
      <header className="iw-case-heading"><div><span className="iw-eyebrow">{item.project || 'WORKSPACE'} <ChevronRight aria-hidden="true" /> INVESTIGATION</span><h2>{item.title}</h2></div><Button variant="outline" onClick={() => onOpenCase(item)}><FileText />Open case</Button></header>
      <div className="iw-state-banner">{localValidation ? <ClipboardList aria-hidden="true" /> : <img src={hermesLogo} width={42} height={42} alt="" />}<div><strong>{localValidation ? 'Local validation' : 'Hermes investigator'}</strong><p role="status" aria-live="polite">{announcement || (current ? runLabels[current.status] || current.status : loaded ? 'Ready for your first investigation' : 'Loading investigation history…')}</p></div>{current && <span className={`iw-dot ${isRunActive(current.status) ? 'iw-active' : ''}`} aria-hidden="true" />}</div>
      {readError && <div className="iw-warning"><p>{readError}</p><p>Saved information may be out of date. Refreshing automatically.</p></div>}
      {error && <p className="iw-error" role="alert">{error}</p>}
      {pending && !busy && <div className="iw-warning"><p>A {pending.label} request has an unconfirmed outcome. Its original request is retained.</p><Button variant="outline" onClick={() => void submit(pending)}><RefreshCw />Retry pending request</Button></div>}
      <div className="iw-problem"><div><span className="iw-eyebrow">REPORTED PROBLEM</span><p>{item.description || 'No problem description was supplied.'}</p></div><div><span className="iw-eyebrow">EXPECTED BEHAVIOR</span><p>{item.expected || 'No expected behavior was supplied.'}</p></div></div>
      {runs.length > 0 && <label className="iw-field iw-history-picker"><span><History aria-hidden="true" />Investigation history</span><select aria-label="Investigation history" value={current?.id || ''} onChange={event => selectRun(event.target.value)}>{runs.map((run, index) => <option key={run.id} value={run.id}>{index === 0 ? 'Latest · ' : ''}{date(run.created_at)} · {runLabels[run.status] || run.status}</option>)}</select></label>}
      {current ? <>
        {stale && <div className="iw-warning"><strong>Source context has changed</strong><p>This investigation used build {current.build}, revision {current.case_revision}. The case is now on build {item.build || 'unnamed'}, revision {item.revision}. Its proposal cannot be reviewed as current evidence.</p></div>}
        <div className="iw-section-heading"><h3>{localValidation ? 'Validation results' : 'Agent findings'}</h3><span className="iw-tag">{latestReview ? reviewLabels[latestReview.decision] : localValidation ? 'Locally recorded results' : 'Agent proposal'}</span></div>
        <p className="iw-subtle">{current.detail}</p>
        {current.output?.trim() ? <><div className="iw-proposal"><pre>{current.output}</pre></div><p className="iw-caption">{localValidation ? `Local validation attributed to ${inspectorName(current.context)} (locally supplied identity). Inspect any recorded evidence below; this is not a live Hermes investigation or independent verification.` : 'Agent-generated proposal. A review records your decision; it does not verify a fix or publish memory.'}</p></> : <div className="iw-empty-panel"><ClipboardList aria-hidden="true" /><p>{isRunActive(current.status) ? 'Hermes has not returned findings yet. Its saved run progress appears below.' : 'This run did not return a proposal. Inspect its history before starting another investigation.'}</p></div>}
        {!guest && isRunActive(current.status) && <div className="iw-actions"><Button variant="outline" disabled={!!busy || !!pending || current.status === 'stopping'} pending={busy === 'stop'} onClick={() => void runAction('stop')}><Square />Request stop</Button>{current.status === 'attention' && <Button variant="outline" disabled={!!busy || !!pending} pending={busy === 'reconcile'} onClick={() => void runAction('reconcile')}><RefreshCw />Reconcile run</Button>}</div>}
        <details className="iw-details" open><summary>Saved run progress <span>{current.events.length}</span></summary><p className="iw-caption">{localValidation ? 'Recorded local validation milestones. Inspect the attached logs for the commands and their actual outcomes.' : 'Coordinator state changes are separate from the evidence journal below. They do not independently prove browser actions or repair verification.'}</p><ol className="iw-timeline">{current.events.map(event => <li key={event.sequence}><span className="iw-timeline-mark" aria-hidden="true" /><div><p>{event.detail}</p><time dateTime={event.at}>{date(event.at)}</time></div></li>)}</ol></details>
        <InvestigationEvidence key={current.id} runId={current.id} runVersion={current.version} localValidation={localValidation} />
        {reviewable && <form className="relay-card iw-review" onSubmit={saveReview}><div className="iw-section-heading"><h3>{localValidation ? 'Review this result' : 'Review this proposal'}</h3><ShieldCheck aria-hidden="true" /></div><p className="iw-subtle">Tell Hermes what is useful and what it should check next. Your feedback stays attached to this run.</p><div className="iw-form-row"><label className="iw-field">Review decision<select value={draft.decision} disabled={!!busy || !!pending} onChange={event => editDraft({ decision: event.target.value as ReviewDraft['decision'] })}><option value="needs_changes">Needs another check</option><option value="accepted">Review accepted</option><option value="dismissed">Dismiss proposal</option></select></label><label className="iw-field">Reviewer name<input autoComplete="name" required maxLength={120} value={draft.reviewer} disabled={!!busy || !!pending} onChange={event => editDraft({ reviewer: event.target.value })} placeholder="Your name" /></label></div><label className="iw-field">Review feedback<textarea required maxLength={8000} rows={4} value={draft.feedback} disabled={!!busy || !!pending} onChange={event => editDraft({ feedback: event.target.value })} placeholder="Which claim needs evidence? What should Hermes check or correct?" /></label><div className="iw-actions"><ApprovalButton type="submit" label="Save review" successLabel="Review saved" state={reviewState?.id === current.id ? reviewState.state : 'neutral'} disabled={!!busy || !!pending || !draft.reviewer.trim() || !draft.feedback.trim() || !!readError} /><span className="iw-caption">Reviewer name is supplied locally.</span></div></form>}
        {!!currentReviews.length && <details className="iw-details" open><summary>Review history <span>{currentReviews.length}</span></summary>{currentReviews.map(review => <article className="iw-review-record" key={review.id}><div><strong>{reviewLabels[review.decision]}</strong><time dateTime={review.created_at}>{date(review.created_at)}</time></div><p>{review.feedback}</p><small>{review.reviewer} · Local reviewer · Source build {review.build}</small></article>)}</details>}
      </> : loaded && <div className="iw-empty-panel"><ClipboardList aria-hidden="true" /><h3>No investigation yet</h3><p>Check the context packet, choose a time limit, and start Hermes. Results will remain linked to this case.</p></div>}
      <details className="iw-details"><summary>Human-recorded evidence <span>{item.observations.length}</span></summary>{item.observations.length ? item.observations.map(observation => {
        const href = safeEvidenceUrl(observation.evidence_url)
        return <article className="iw-review-record" key={observation.id}><div><strong>{humanStatus[observation.result]}</strong><span>Build {observation.build}</span></div><p>{observation.observed}</p><small>{observation.author} · {date(observation.at)}</small>{observation.steps && <details><summary>Recorded steps</summary><pre>{observation.steps}</pre></details>}{href && <a href={href} target="_blank" rel="noopener noreferrer">Open evidence reference <ArrowRight aria-hidden="true" /></a>}</article>
      }) : <p className="iw-caption">No human observations have been recorded for this case.</p>}<Button variant="outline" onClick={() => onOpenCase(item)}>Record an observation<ArrowRight /></Button></details>
    </section>
    <aside className="iw-context" aria-label="Investigator context and controls">
      {current && <InvestigationCost key={current.id} run={current} runs={runs} />}
      <div className="iw-context-heading"><span className="iw-eyebrow">NEXT INVESTIGATION</span><h2>What Hermes will receive</h2><p>Inspect the exact source context before starting.</p></div>
      <Button variant="outline" disabled={!!busy || !!pending} onClick={() => void refreshContext()}><RefreshCw />Refresh context</Button>
      {followUpReviewId && <Button variant="ghost" disabled={!!busy || !!pending} onClick={() => setExcludedReviewId(followUpReviewId)}>Use current case only</Button>}
      {latestReview?.decision === 'needs_changes' && excludedReviewId === latestReview.id && <div className="iw-followup"><div><strong>Current case context only</strong><p>This new investigation will not include the earlier proposal or review feedback.</p><Button variant="ghost" disabled={!!busy || !!pending} onClick={() => setExcludedReviewId(null)}>Include requested corrections</Button></div></div>}
      {previewError ? <div className="iw-warning"><p>{previewError}</p></div> : !preview ? <p className="iw-subtle">Preparing the current context…</p> : <>
        <dl className="iw-context-facts"><div><dt>Current build</dt><dd>{preview.build || 'Not named'}</dd></div><div><dt>Case revision</dt><dd>{preview.case_revision}</dd></div><div><dt>Source events</dt><dd>{counts.events}</dd></div><div><dt>Reviewed memories</dt><dd>{counts.memories}</dd></div></dl>
        {followUpReviewId && <div className="iw-followup"><RefreshCw aria-hidden="true" /><div><strong>Follow-up context included</strong><p>The previous proposal and your requested corrections accompany the current case context.</p></div></div>}
        <details className="iw-details iw-packet" open><summary>Exact context packet</summary><pre>{JSON.stringify(preview.context, null, 2)}</pre></details>
        <p className="iw-caption">Starting uses this context snapshot. If its sources change, Relay requires a fresh preview.</p>
        {!previewCurrent && <p className="iw-warning">The case changed since this view loaded. Refresh context to load its current build and revision.</p>}
      </>}
      <div className="iw-dispatch"><div className="iw-runtime"><span className={`iw-dot ${runner?.available && !guest ? 'iw-active' : ''}`} aria-hidden="true" /><strong>{guest ? 'Guest workspace' : runner?.available ? 'Hermes connected' : 'Runtime connection needed'}</strong></div><p className="iw-subtle">{guest ? 'Guest workspaces cannot start investigations.' : runner?.reason || 'Checking the runtime connection…'}</p>{!guest && <>
        <Button variant="outline" pending={busy === 'connection'} disabled={!!busy || !!pending} onClick={() => void runAction('connection')}><RefreshCw />Check connection</Button>
        <label className="iw-field">Investigation time limit<select value={maxSeconds} disabled={!!busy || !!pending || !!activeRun} onChange={event => setMaxSeconds(Number(event.target.value))}><option value={30}>30 seconds</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option></select></label>
        <Button className="iw-start" disabled={!canStart} pending={busy === 'start'} onClick={start}><Play />{followUpReviewId ? 'Start follow-up investigation' : 'Start Hermes investigation'}</Button>
        {!item.build.trim() && <p className="iw-warning">Name the current build in the case before starting.</p>}
        {activeRun && <p className="iw-caption">An investigation is already active. Wait for completion or request a stop.</p>}
        <p className="iw-caption">Time limits request a cooperative stop. Tool permissions and spending limits are controlled by your Hermes runtime.</p>
      </>}</div>
      {current && <><details className="iw-details iw-packet"><summary>Context used by selected run</summary><p className="iw-caption">Build {current.build} · Revision {current.case_revision}</p><pre>{JSON.stringify(current.context, null, 2)}</pre></details></>}
    </aside>
  </>
}
