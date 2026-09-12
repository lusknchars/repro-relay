import { spawn, spawnSync } from 'node:child_process'
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid, 'SIGTERM')
    } catch (error) {if (error.code !== 'ESRCH') console.error(error.message)}
  }
  process.exitCode = code
}
for (const [command, args] of [['docker',['compose','up','-d','--wait','db']], ['cargo',['build','-p','relay-api']]]) {
  const result = spawnSync(command, args, {stdio:'inherit'})
  if (result.status !== 0) process.exit(result.status || 1)
}
for (const [command, args] of [['cargo',['run','-p','relay-api']], ['npm',['run','dev','--prefix','web']]]) {
  const child = spawn(command,args,{stdio:'inherit',detached:process.platform !== 'win32'})
  children.push(child)
  child.on('error',error=>{console.error(error.message);stop(1)})
  child.on('exit',code=>stop(code || 0))
}
process.on('SIGINT',()=>stop())
process.on('SIGTERM',()=>stop())
