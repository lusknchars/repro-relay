import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FolderGit2, GitBranch, RefreshCw, Terminal } from 'lucide-react'
import { Button } from './ui/button'
import { message, request } from '../lib/api'
import { useWorkspaceCommands } from '../lib/desktop'

type Repository = {root:string;branch:string;head:string;changes:string;worktrees:string}
type Connection = {workspace:'checking'|'connected'|'offline';hermes:'checking'|'ready'|'unavailable'|'unknown'}
async function native<T>(command:string):Promise<T> {const {invoke}=await import('@tauri-apps/api/core');return invoke<T>(command)}

export function DesktopWorkbench() {
  const desktop='__TAURI_INTERNALS__' in window
  const [repository,setRepository]=useState<Repository|null>(null)
  const [expanded,setExpanded]=useState(false)
  const [tab,setTab]=useState<'changes'|'worktrees'|'connection'>('changes')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [checked,setChecked]=useState('')
  const [connection,setConnection]=useState<Connection>({workspace:'checking',hermes:'checking'})
  const lock=useRef(false)
  const generation=useRef(0)
  const toggle=useRef<HTMLButtonElement>(null)
  const dock=useRef<HTMLElement>(null)
  useEffect(()=>{
    if(!desktop || !dock.current)return
    const root=document.documentElement
    root.dataset.repositoryTools='true'
    const observer=new ResizeObserver(entries=>root.style.setProperty('--repository-tools-height',`${entries[0].target.getBoundingClientRect().height}px`))
    observer.observe(dock.current)
    return()=>{observer.disconnect();delete root.dataset.repositoryTools;root.style.removeProperty('--repository-tools-height')}
  },[desktop])
  useEffect(()=>{
    if(!desktop)return
    let disposed=false
    const current=++generation.current
    void native<Repository|null>('repository_status').then(value=>{if(!disposed && generation.current===current){setRepository(value);setChecked(new Date().toLocaleTimeString())}}).catch(e=>{if(!disposed && generation.current===current)setError(message(e))})
    return()=>{disposed=true}
  },[desktop])
  useEffect(()=>{
    if(!desktop)return
    const abort=new AbortController()
    let disposed=false,checking=false
    async function inspect() {
      if(checking)return
      checking=true
      try {
        const [health,runner]=await Promise.allSettled([request<{status:string;mode:string}>('/health',{signal:abort.signal}),request<{available:boolean}>('/runner',{signal:abort.signal})])
        if(!disposed)setConnection({workspace:health.status==='fulfilled' && health.value.status==='ok' && health.value.mode==='local'?'connected':'offline',hermes:runner.status==='fulfilled' ? runner.value.available?'ready':'unavailable':'unknown'})
      }finally{checking=false}
    }
    void inspect();const timer=setInterval(()=>void inspect(),10000)
    return()=>{disposed=true;abort.abort();clearInterval(timer)}
  },[desktop])
  async function action(command:'repository_status'|'select_repository'|'open_repository_terminal') {
    if(lock.current)return
    lock.current=true;generation.current++;setBusy(true);setError('');setNotice('')
    try {
      if(command==='open_repository_terminal'){await native(command);setNotice('Terminal opened in this repository.')}
      else {const result=await native<Repository|null>(command);if(result){setRepository(result);setChecked(new Date().toLocaleTimeString());setExpanded(true)}}
    }catch(e){setError(message(e));setExpanded(true)}
    finally{lock.current=false;setBusy(false)}
  }
  useWorkspaceCommands(useCallback(command=>{
    if(!desktop)return
    if(command==='repository-tools')setExpanded(value=>!value)
    if(command==='open-repository')void action('select_repository')
  },[desktop]))
  function close(){setExpanded(false);toggle.current?.focus()}
  if(!desktop)return null
  const changes=repository?.changes.split('\n').filter(Boolean) || []
  const worktrees=repository?.worktrees.split('\n\n').filter(Boolean).map(record=>Object.fromEntries(record.split('\n').map(line=>{const i=line.indexOf(' ');return i<0?[line,true]:[line.slice(0,i),line.slice(i+1)]}))) || []
  return <section ref={dock} className="desktop-workbench" aria-label="Native repository tools" onKeyDown={event=>{if(event.key==='Escape' && expanded){event.stopPropagation();close()}}}>
    <header className="desktop-workbench-bar">
      <Button ref={toggle} variant="ghost" aria-expanded={expanded} aria-controls="repository-panel" onClick={()=>setExpanded(value=>!value)}><FolderGit2/><span>{repository ? repository.root.split(/[\\/]/).pop() : 'Repository tools'}</span>{expanded?<ChevronDown/>:<ChevronUp/>}</Button>
      {repository && <span className="desktop-branch"><GitBranch size={14}/>{repository.branch}</span>}
      <div className="desktop-workbench-status"><button onClick={()=>{setTab('connection');setExpanded(true)}}><span className={`connection-dot ${connection.workspace}`} aria-hidden="true"/>Workspace {connection.workspace==='connected'?'connected':connection.workspace==='checking'?'checking':'offline'}</button><button onClick={()=>{setTab('connection');setExpanded(true)}}><span className={`connection-dot ${connection.hermes}`} aria-hidden="true"/>Hermes {connection.hermes==='ready'?'ready':connection.hermes==='unavailable'?'not connected':connection.hermes}</button></div>
      <Button variant="ghost" disabled={busy} onClick={()=>void action('select_repository')}><FolderGit2/>{repository?'Switch repository':'Open repository'}</Button>
      <Button variant="outline" disabled={!repository||busy} onClick={()=>void action('open_repository_terminal')}><Terminal/>Open terminal</Button>
    </header>
    {expanded && <div id="repository-panel" className="desktop-repository-panel">
      <div className="desktop-repository-heading"><nav aria-label="Repository tools"><Button variant={tab==='changes'?'secondary':'ghost'} aria-current={tab==='changes'?'page':undefined} onClick={()=>setTab('changes')}>Changes {repository && <span>{changes.length}</span>}</Button><Button variant={tab==='worktrees'?'secondary':'ghost'} aria-current={tab==='worktrees'?'page':undefined} onClick={()=>setTab('worktrees')}>Worktrees</Button><Button variant={tab==='connection'?'secondary':'ghost'} aria-current={tab==='connection'?'page':undefined} onClick={()=>setTab('connection')}>Connection</Button></nav><Button variant="ghost" disabled={busy||!repository} pending={busy} onClick={()=>void action('repository_status')}><RefreshCw/>Refresh Git</Button></div>
      {error && <p role="alert" className="iw-warning">{error}</p>}{notice && <p role="status">{notice}</p>}
      {tab!=='connection' && !repository && <div className="desktop-repository-empty"><FolderGit2 size={25}/><h2>Open your repository</h2><p>Inspect tracked changes and isolated checkouts, then continue in your terminal.</p><Button disabled={busy} onClick={()=>void action('select_repository')}>Choose a folder</Button></div>}
      {tab!=='connection' && repository && <>
        <p className="desktop-repository-path">{repository.root}</p>
        {tab==='changes' && <>{changes.length ? <ul className="desktop-change-list" aria-label="Tracked changes">{changes.map((line,index)=><li key={index}><code>{line.slice(0,2)}</code><span>{line.slice(3)}</span></li>)}</ul>:<p>No tracked changes.</p>}<p className="desktop-repository-caption">Git status at {checked}. Untracked files and submodule contents are excluded.</p></>}
        {tab==='worktrees' && <ul className="desktop-worktree-list" aria-label="Git worktrees">{worktrees.map((tree,index)=><li key={index}><GitBranch size={16}/><div><strong>{tree.branch ? String(tree.branch).replace('refs/heads/','') : tree.detached?'Detached checkout':'Checkout'}</strong><p>{String(tree.worktree || '')}</p><code>{String(tree.HEAD || '').slice(0,12)}</code>{tree.locked && <span> · Locked</span>}</div></li>)}</ul>}
        <details className="desktop-repository-caption"><summary>Repository scope</summary><p>Opening this folder controls native Git inspection and terminal location. Hermes continues to use the repository and permissions configured for its investigation. Existing worktrees are listed here; repair approval and dispatch stay attached to their case.</p><p>HEAD: <code>{repository.head}</code></p></details>
      </>}
      {tab==='connection' && <div className="desktop-connection-details"><div><h2>Local workspace</h2><p>{connection.workspace==='connected'?'Connected to the local workspace service.':connection.workspace==='checking'?'Checking the local service…':'Start the local workspace service to load cases and agent activity.'}</p><code>127.0.0.1:8178</code></div><div><h2>Hermes investigator</h2><p>{connection.hermes==='ready'?'The runtime is available. Follow actual runs in Agent controls.':connection.hermes==='unavailable'?'Connect and sign in to your Hermes runtime, then check Agent controls.':'Runtime availability has not been confirmed.'}</p><p>Opening a terminal does not start an investigation.</p></div></div>}
    </div>}
  </section>
}
