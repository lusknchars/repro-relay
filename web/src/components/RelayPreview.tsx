import { useState } from 'react'
import { ArrowRight, Check, FileCheck2, GitCommitHorizontal, RotateCcw, ShieldAlert } from 'lucide-react'
import { Button } from './ui/button'

export function RelayPreview() {
  const [changed, setChanged] = useState(false)
  return <section className={`relay-preview ${changed ? 'preview-stale' : ''}`} aria-label="Interactive handoff example">
    <div className="preview-topline"><span><span className="preview-dot"/>Handoff preview</span><span>Sample data</span></div>
    <div className="preview-document">
      <div className="preview-document-heading"><span className="document-icon"><FileCheck2 size={26}/></span><div><small>Reports / CSV export</small><h2>Ready for the next agent.</h2></div></div>
      <div className="preview-evidence"><span className="evidence-line"/><div><span className="preview-check"><Check size={14}/></span><p>Report captured<small>Export produces no file</small></p></div><div><span className="preview-check"><Check size={14}/></span><p>Observation attached<small>Steps, build, and evidence link</small></p></div><div><span className="preview-check"><Check size={14}/></span><p>Handoff prepared<small>Evidence preserved at build a41c9e</small></p></div></div>
      <div className="preview-build"><span><GitCommitHorizontal size={17}/>Current build</span><code key={String(changed)}>{changed ? 'b72f03' : 'a41c9e'}</code></div>
      <div className={`preview-result ${changed ? 'stale' : ''}`} role="status" aria-live="polite" aria-atomic="true" key={`result-${changed}`}>
        {changed ? <ShieldAlert size={20}/> : <Check size={20}/>}
        <div><strong>{changed ? 'Outdated context caught.' : 'Context matches the build.'}</strong><p>{changed ? 'The build changed. Prepare a new handoff before using this evidence.' : 'The saved handoff and current build agree.'}</p></div>
      </div>
    </div>
    <div className="preview-action"><p>{changed ? 'The original evidence stays intact.' : 'What happens when the build changes?'}</p><Button variant="outline" size="sm" onClick={()=>setChanged(!changed)}>{changed ? <RotateCcw/> : <GitCommitHorizontal/>}{changed ? 'Reset example' : 'Change example build'}{!changed && <ArrowRight/>}</Button></div>
  </section>
}
