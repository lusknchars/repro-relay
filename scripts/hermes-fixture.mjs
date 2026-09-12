// Controlled HTTP fixture for browser tests. No model, browser, or external tools.
import { createServer } from 'node:http'
if (process.env.REPRO_FIXTURE_ONLY !== '1') throw new Error('Set REPRO_FIXTURE_ONLY=1 to run this test fixture.')
const runs = new Map()
const byKey = new Map()
createServer(async (req,res)=>{
  res.setHeader('Content-Type','application/json')
  const send=(code,value)=>{res.writeHead(code);res.end(JSON.stringify(value))}
  if(req.url==='/health')return send(200,{fixture:true})
  if(req.headers.authorization!=='Bearer browser-fixture-key')return send(401,{error:'Fixture authentication required'})
  if(req.url==='/v1/capabilities')return send(200,{features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}})
  if(req.url==='/v1/runs'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk
    const key=req.headers['idempotency-key']
    if(byKey.has(key)){
      const old=runs.get(byKey.get(key));if(old.body!==body)return send(409,{error:'Idempotency conflict'})
      return send(202,{run_id:old.id,status:'started'})
    }
    const id=`run_fixture_${runs.size+1}`
    runs.set(id,{id,body,polls:0,stopped:false,slow:body.includes('Hold fixture')});byKey.set(key,id)
    return send(202,{run_id:id,status:'started'})
  }
  const match=req.url.match(/^\/v1\/runs\/(run_fixture_\d+)(\/stop)?$/)
  const run=match&&runs.get(match[1]);if(!run)return send(404,{error:'Fixture run missing'})
  if(match[2]&&req.method==='POST'){run.stopped=true;return send(200,{status:'stopping'})}
  run.polls++
  const status=run.stopped?'cancelled':run.slow||run.polls<2?'running':'completed'
  return send(200,{run_id:run.id,status,output:status==='completed'?'Controlled fixture proposal: export requires investigation. No real browser actions were executed.':null,usage:status==='completed'?{input_tokens:25,output_tokens:17,total_tokens:42}:null})
}).listen(8654,'127.0.0.1')
