"""Real, isolated Docker smoke test. No provider requests or Discord login.

First build the app and Hermes/Discord images named by compose.connected.yaml.
Only this script's randomly named Compose project and volumes are removed.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    project = 'relay-connected-test-' + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix='relay-connected-smoke-') as directory:
        override = Path(directory) / 'compose.yaml'
        override.write_text('services:\n  app:\n    ports: !reset []\n')
        base = ['docker', 'compose', '--env-file', '/dev/null', '-p', project,
                '-f', str(ROOT / 'compose.local.yaml'), '-f', str(ROOT / 'compose.connected.yaml'), '-f', str(override)]
        def compose(*args):
            return subprocess.run([*base, *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout
        def app(code):
            return compose('exec', '-T', 'app', 'python3', '-c', code).strip()
        get_runner = 'import json,urllib.request; print(json.load(urllib.request.urlopen("http://127.0.0.1:8178/api/v1/runner"))["available"])'
        profile = 'import sys; sys.path.insert(0,"/app/integrations/connected"); import launch; '
        try:
            compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
            assert app(get_runner) == 'False', 'Fresh install must not claim a connected model'
            fingerprint = app(profile + 'import hashlib; print(hashlib.sha256(launch.initialize().encode()).hexdigest())')
            app(profile + 's=launch.provider_setup.status(); launch.provider_setup.save({"revision":s["revision"],"provider":"openai-api","model":"fixture-model","api_key":"fixture-never-use-for-model-requests"})')
            for _ in range(60):
                if app(get_runner) == 'True': break
                time.sleep(1)
            else: raise AssertionError('Hermes capabilities did not become available')
            app('import sys; sys.path.insert(0,"/app/integrations/connected"); import prepare_notes; prepare_notes.main()')
            code = '''import sys,uuid,json
sys.path.insert(0,"/app/integrations/discord-voice")
from core import Relay
r=Relay()
c=r.request("POST","/cases",{"title":"Call-link fixture","project":"Smoke","url":"https://example.com","description":"Metadata test","expected":"No audio","build":"fixture"})
e={"case_id":c["id"],"body":{"id":str(uuid.uuid4()),"call_id":str(uuid.uuid4()),"guild_id":"1234567890123456","channel_id":"2234567890123456","actor_id":"3234567890123456","status":"joined"}}
assert r.record(e)==r.record(e)
assert len(r.request("GET","/cases/"+c["id"]+"/discord-calls")["items"])==1
notes={"id":str(uuid.uuid4()),"call_id":e["body"]["call_id"],"guild_id":e["body"]["guild_id"],"channel_id":e["body"]["channel_id"],"consented_user_ids":[e["body"]["actor_id"]],"duration_ms":10000,"retention_days":7,"segments":[{"speaker":e["body"]["actor_id"],"start_ms":0,"text":"Synthetic fixture: review the export logs."}]}
assert r.request("POST","/cases/"+c["id"]+"/discord-notes",notes)["saved"]
assert r.request("POST","/cases/"+c["id"]+"/discord-notes",notes)["saved"]
print(c["id"])
'''
            case = compose('--profile', 'discord', 'run', '--rm', '--no-deps', '--entrypoint', 'python', 'discord-bot', '-c', code).strip()
            assert case.startswith('RR-'), case
            worker = '''import sys,tempfile
from pathlib import Path
sys.path.insert(0,"/app/integrations/reach")
import hermes_chat
class Fixture:
 def request(self,method,path,body=None,identity=None):
  if path=="/health": return {}
  if method=="POST":
   assert "Synthetic fixture: review the export logs." in body["input"]
   return {"run_id":"run_"+"a"*32}
  return {"status":"completed","output":"HTTP fixture summary: review the export logs. No live model was used."}
api=hermes_chat.chat.API(Path("/app/.data/reach/chat-bridge.json"),hermes_chat.reach.call.evidence)
with tempfile.TemporaryDirectory() as directory:
 worker=hermes_chat.Worker(api,Fixture(),Path(directory))
 assert worker.tick()=="started"
 assert worker.tick()=="replied"
print("fixture Team reply confirmed")
'''
            assert 'fixture Team reply confirmed' in compose('exec','-T','hermes','python','-c',worker)
            compose('restart', 'app', 'hermes')
            for _ in range(60):
                try:
                    if app(get_runner) == 'True': break
                except subprocess.CalledProcessError: pass
                time.sleep(1)
            else: raise AssertionError('Connected restart did not recover')
            assert app(profile + 'import hashlib; print(hashlib.sha256(launch.initialize().encode()).hexdigest())') == fingerprint
            check = 'import json,urllib.request; v=json.load(urllib.request.urlopen("http://127.0.0.1:8178/api/v1/cases/' + case + '/discord-calls")); assert len(v["items"])==1; print("ok")'
            assert app(check) == 'ok'
            print('PASS: fresh stack, real Hermes capabilities, call/notes receipt retry, Team bridge and fixture reply, restart and persistence. No model call or Discord connection.')
        finally:
            compose('--profile', 'discord', '--profile', 'notes', 'down', '--volumes', '--remove-orphans')


if __name__ == '__main__': main()
