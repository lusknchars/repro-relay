import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Copy, UserRound, Users, X } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { message, request } from '../lib/api'

type Account = { enabled: boolean; authenticated: boolean; bootstrap_available?: boolean; shared?: boolean; role?: 'owner' | 'viewer' | null; profile?: { id: string; username: string; name: string; bio: string } }
type Team = { members: { id: string; name: string; username: string; role: string }[]; invites: { id: string; return_to: string; expires_at: string; used: boolean; revoked: boolean }[] }
function inviteToken() { return new URLSearchParams(window.location.hash.slice(1)).get('invite') || '' }
function currentTarget(fallback: string) {
  const source = new URLSearchParams(window.location.search), result = new URLSearchParams()
  const view = source.get('view') || 'overview'
  result.set('view', view)
  const key = view === 'sessions' ? 'audit' : ['agents','inbox'].includes(view) ? 'case' : ''
  if (key && source.get(key)) result.set(key, source.get(key)!)
  return source.size ? '/?' + result.toString() : fallback
}
function resume(target = '/') {
  if (target !== '/' && !target.startsWith('/?')) throw new Error('The session link is invalid.')
  window.location.assign(target)
}
function accountRequest<T>(path: string, body?: unknown) {
  return request<T>(path, { credentials: 'include', ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) })
}

export function AccountPanel({ returnTo = '/', closed }: { returnTo?: string; closed?: () => void }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [link, setLink] = useState('')
  const [localLink, setLocalLink] = useState(false)
  const pending = useRef(false)
  const token = inviteToken()
  async function load() {
    const value = await accountRequest<Account>('/account')
    setAccount(value)
    if (value.bootstrap_available) setCreate(true)
    if (value.role === 'owner') setTeam(await accountRequest<Team>('/team'))
  }
  useEffect(() => { void load().catch(e => setError(message(e))) }, [])
  async function act(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(message(e)) }
    finally { pending.current = false; setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget)
    await act(async () => {
      const value = await accountRequest<{ return_to?: string }>(create ? '/account/register' : '/account/login', {
        username: fields.get('username'), password: fields.get('password'),
        ...(create ? { name: fields.get('name'), invite_token: token } : {}),
      })
      if (create) resume(value.return_to)
      else if (token) await load()
      else window.location.reload()
    })
  }
  return <section className="space-y-5" aria-label="Account and team">
    {error && <p role="alert" className="iw-warning">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!account && !error && <p role="status">Checking your account…</p>}
    {account && !account.enabled && <p>Accounts are available on the team server, outside the temporary guest beta.</p>}
    {account?.enabled && !account.authenticated && <>
      <p className="text-sm text-muted-foreground">{account.bootstrap_available ? 'Create the owner profile for this Relay installation. Your existing cases and investigation history stay here.' : token ? 'This invitation lets you follow the team’s saved work. Create an account or sign in to join.' : 'Sign in to return to your team and its saved investigation history. New teammates need an invitation.'}</p>
      <form onSubmit={submit} className="space-y-4">
        {create && <label className="field"><span>Display name</span><input name="name" required maxLength={80} autoComplete="name" disabled={busy}/></label>}
        <label className="field"><span>Username</span><input name="username" aria-label="Username" aria-describedby="account-username-hint" required minLength={3} maxLength={40} autoCapitalize="none" autoComplete="username" disabled={busy}/><small id="account-username-hint">3–40 letters, numbers, underscores or hyphens.</small></label>
        <label className="field"><span>Password</span><input name="password" aria-label="Password" aria-describedby="account-password-hint" type="password" required minLength={15} maxLength={128} autoComplete={create ? 'new-password' : 'current-password'} disabled={busy}/><small id="account-password-hint">Use 15–128 characters.</small></label>
        <div className="flex flex-wrap gap-2"><Button pending={busy} disabled={busy} type="submit">{create ? token ? 'Create account and join' : 'Create owner account' : 'Sign in'}</Button>
          {(token || account.bootstrap_available) && <Button variant="ghost" type="button" disabled={busy} onClick={() => {setCreate(v => !v);setError('')}}>{create ? 'I already have an account' : 'Create an account'}</Button>}</div>
      </form>
    </>}
    {account?.authenticated && account.profile && <>
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-content-center rounded-full border bg-muted text-lg font-medium" aria-hidden="true">{account.profile.name.slice(0,1).toUpperCase()}</span><div className="min-w-0 break-words"><h3 className="font-semibold">{account.profile.name}</h3><p className="text-sm text-muted-foreground">@{account.profile.username} · {account.role || 'Invitation required'}</p></div></div>
      {token && <div className="rounded-lg border p-4 space-y-3"><h3 className="font-medium">Join the shared workspace</h3><p className="text-sm">Viewer access includes the team’s case history, saved sessions and investigation results. The owner controls changes and agent execution.</p><Button disabled={busy} pending={busy} onClick={() => void act(async () => {const result = await accountRequest<{return_to:string}>('/team/join',{token});resume(result.return_to)})}>Join and open session</Button></div>}
      <form className="space-y-3" key={account.profile.id} onSubmit={event => {event.preventDefault();const form = new FormData(event.currentTarget);void act(async () => {setAccount(await accountRequest<Account>('/account',{name:form.get('name'),bio:form.get('bio')}));setNotice('Profile saved.')})}}>
        <label className="field"><span>Display name</span><input name="name" required maxLength={80} defaultValue={account.profile.name} disabled={busy}/></label>
        <label className="field"><span>About you</span><textarea name="bio" maxLength={300} rows={2} placeholder="Your role or what you work on" defaultValue={account.profile.bio} disabled={busy}/></label>
        <Button variant="outline" disabled={busy} type="submit">Save profile</Button>
      </form>
      {account.role === 'owner' && <div className="space-y-4 border-t pt-4">
        <div><h3 className="font-semibold flex items-center gap-2"><Users className="size-4"/>Your team</h3><p className="text-sm text-muted-foreground">Invite one teammate back to this view. Each link lasts 24 hours and can be accepted by one account.</p></div>
        <Button disabled={busy} pending={busy} onClick={() => void act(async () => {const result=await accountRequest<{url:string;local_only:boolean}>('/team/invites',{return_to:currentTarget(returnTo)});setLink(result.url);setLocalLink(result.local_only);await load()})}>Create invitation link</Button>
        {link && <div className="space-y-2"><label className="field"><span>{localLink ? 'Local preview invitation' : 'Invitation link'}</span><input readOnly value={link} onFocus={e => e.target.select()}/></label><Button variant="outline" onClick={() => void act(async () => {await navigator.clipboard.writeText(link);setNotice('Invitation copied. Share it with the teammate you want to invite.')})}><Copy/>Copy invitation</Button>{localLink && <p className="text-sm text-muted-foreground">This localhost link opens only on this Mac. Use team mode on your shared HTTPS server to invite someone on another computer.</p>}</div>}
        {team?.members.map(member => <div key={member.id} className="flex items-center justify-between gap-3 border-t py-3"><p className="min-w-0 break-words text-sm">{member.name} <span className="text-muted-foreground">· {member.role}</span></p>{member.role !== 'owner' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(async () => {await accountRequest(`/team/members/${member.id}/remove`,{});await load();setNotice('Access removed and sign-ins revoked.')})}>Remove access</Button>}</div>)}
        {!!team?.invites.length && <details><summary className="cursor-pointer text-sm">Invitation history</summary>{team.invites.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{invitation.revoked ? 'Revoked' : invitation.used ? 'Accepted' : new Date(invitation.expires_at).getTime()<Date.now() ? 'Expired' : 'Pending'} · {new Date(invitation.expires_at).toLocaleString()}</span>{!invitation.revoked && !invitation.used && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {await accountRequest(`/team/invites/${invitation.id}/revoke`,{});await load();setLink('')})}>Revoke link</Button>}</div>)}</details>}
      </div>}
      <details className="border-t pt-4"><summary className="cursor-pointer text-sm">Change password</summary><form className="space-y-3 pt-3" onSubmit={event => {event.preventDefault();const form = new FormData(event.currentTarget);void act(async () => {await accountRequest('/account/password',{current_password:form.get('current'),new_password:form.get('next')});window.location.reload()})}}>
        <label className="field"><span>Current password</span><input name="current" type="password" required maxLength={128} autoComplete="current-password"/></label><label className="field"><span>New password</span><input name="next" type="password" required minLength={15} maxLength={128} autoComplete="new-password"/></label><Button type="submit" variant="outline" disabled={busy}>Change password and sign out everywhere</Button>
      </form></details>
      <Button variant="outline" disabled={busy} onClick={() => void act(async () => {await accountRequest('/account/logout',{});window.location.reload()})}>Sign out</Button>
    </>}
    {closed && <Button variant="ghost" onClick={closed}>Back to workspace</Button>}
  </section>
}

export function AccountControl({returnTo}:{returnTo:string}) {
  const [open,setOpen]=useState(Boolean(inviteToken()) || window.location.hash === '#account')
  const [enabled,setEnabled]=useState(false)
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(() => {void accountRequest<Account>('/account').then(a => setEnabled(a.enabled === true)).catch(() => {})},[])
  useEffect(() => {if(!open || !enabled)return;const trigger=document.activeElement;dialog.current?.showModal();return () => {dialog.current?.close();if(trigger instanceof HTMLElement && trigger.isConnected)trigger.focus()}},[open,enabled])
  if(!enabled)return null
  if('__TAURI_INTERNALS__' in window)return <Button asChild variant="outline" size="sm" className="min-h-11 min-w-11"><a href={`http://127.0.0.1:8178${currentTarget(returnTo)}#account`} title="Manage account and team in your browser"><UserRound className="size-4"/><span>Account & team</span></a></Button>
  return <><Button variant="outline" size="sm" className="min-h-11 min-w-11" aria-label="Account & team" title="Account & team" onClick={() => setOpen(true)}><UserRound className="size-4"/><span className="hidden sm:inline">Account & team</span></Button>
    {open && <dialog ref={dialog} aria-labelledby="account-title" onCancel={event => {event.preventDefault();setOpen(false)}} className="account-dialog">
      <div className="dialog-header"><h2 id="account-title">Account & team</h2><Button variant="ghost" size="icon" aria-label="Close account" onClick={() => setOpen(false)}><X/></Button></div>
      <div className="p-5"><AccountPanel returnTo={returnTo} closed={() => setOpen(false)}/></div>
    </dialog>}
  </>
}

export function AccountGate() {
  return <main className="mx-auto max-w-xl p-5 sm:py-16"><h1 className="text-2xl font-semibold mb-2">Return to your team’s work</h1><p className="text-muted-foreground mb-6">Sign in to follow investigations and reopen the session your teammate shared.</p><Card><CardContent className="pt-6"><AccountPanel/></CardContent></Card></main>
}
