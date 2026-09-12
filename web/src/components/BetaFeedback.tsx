import { useState, type FormEvent } from 'react'
import { MessageSquare, Check } from 'lucide-react'
import { Button } from './ui/button'
import { message, request } from '../lib/api'
export function BetaFeedback() {
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  const [sent,setSent]=useState(false)
  const [error,setError]=useState('')
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget)
    setBusy(true);setError('')
    try {await request('/feedback',{method:'POST',body:JSON.stringify({useful:data.get('useful')==='yes',message:data.get('message')})});setSent(true);setOpen(false)}
    catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <section className="beta-feedback" aria-label="Beta feedback">
    <div><span className="guest-pill">Your test workspace</span><p>Sample data only. Expires after 7 days. No agent runs or messages are sent.</p></div>
    <Button size="sm" variant="outline" onClick={()=>setOpen(!open)} aria-expanded={open}><MessageSquare/>{sent?'Update feedback':'Give feedback'}</Button>
    {sent&&!open&&<p className="feedback-sent" role="status"><Check size={14}/>Feedback saved for the project team.</p>}
    {open&&<form onSubmit={e=>void submit(e)}><fieldset><legend>Would this help your team prepare bug investigations?</legend><label><input type="radio" name="useful" value="yes" required/>Yes</label><label><input type="radio" name="useful" value="no" required/>Not yet</label></fieldset><label className="field"><span>What worked, or what is missing?</span><textarea name="message" required minLength={1} maxLength={2000} rows={3}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<Button disabled={busy} type="submit">{busy?'Saving…':'Send feedback'}</Button></form>}
  </section>
}
