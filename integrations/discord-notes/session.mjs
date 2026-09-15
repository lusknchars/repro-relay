import {randomUUID} from 'node:crypto';
export const MAX_MS = 600_000;
const RATE = 16_000;
export class Session {
  constructor({members, caseId, guildId, channelId, actorId, retentionDays=7}, clock=Date.now) {
    if (members.length<1 || members.length>5 || new Set(members).size!==members.length) throw Error('Calls support 1–5 participants.');
    this.members = new Set(members); this.consents = new Set(); this.clock=clock;
    this.caseId=caseId; this.guildId=guildId; this.channelId=channelId; this.actorId=actorId;
    this.retentionDays=retentionDays; this.id=randomUUID(); this.notesId=randomUUID();
    this.state='consent'; this.buffers=new Map(); this.ends=new Map(); this.bytes=0;
  }
  consent(userId) {
    if (this.state!=='consent' || !this.members.has(userId)) throw Error('Not a participant in this consent request.');
    this.consents.add(userId); return this.consents.size===this.members.size;
  }
  start() {
    if (this.state!=='consent' || this.consents.size!==this.members.size) throw Error('All participants must consent.');
    this.startedAt=this.clock(); this.state='recording';
  }
  roster(members) {
    if (members.length!==this.members.size || members.some(id=>!this.members.has(id))) { this.cancel(); return false; }
    return true;
  }
  pcm(userId, pcm) {
    if (this.state!=='recording' || !this.consents.has(userId)) return;
    const elapsed=this.clock()-this.startedAt;
    if (elapsed>=MAX_MS) { this.cancel(); return; }
    // Discord PCM is 48 kHz stereo signed 16-bit. Average each six samples to 16 kHz mono.
    const count=Math.floor(pcm.length/12);
    let end=Math.max(Math.round(elapsed*RATE/1000), (this.ends.get(userId)||0)+count);
    if (end>RATE*600) { this.cancel(); return; }
    let buffer=this.buffers.get(userId);
    if (!buffer) { buffer=Buffer.alloc(RATE*600*2); this.buffers.set(userId,buffer); }
    const offset=Math.max(0,end-count);
    for (let i=0;i<count;i++) {
      let sum=0; for(let j=0;j<6;j++) sum+=pcm.readInt16LE(i*12+j*2);
      buffer.writeInt16LE(Math.round(sum/6),(offset+i)*2);
    }
    this.ends.set(userId,end); this.bytes+=pcm.length;
  }
  finish() {
    if(this.state!=='recording') throw Error('No active capture.');
    this.durationMs=Math.min(MAX_MS,Math.max(1,this.clock()-this.startedAt,...[...this.ends.values()].map(n=>Math.ceil(n*1000/RATE)))); this.state='processing';
    return [...this.buffers].map(([speaker,pcm])=>({speaker,audio:wav(pcm.subarray(0,this.ends.get(speaker)*2))}));
  }
  cancel() { this.state='cancelled'; this.clear(); }
  clear() { for (const buffer of this.buffers.values()) buffer.fill(0); this.buffers.clear(); this.ends.clear(); }
  payload(segments) {
    if(this.state!=='processing' || !segments.length) throw Error('No transcript to share.');
    return {id:this.notesId,call_id:this.id,guild_id:this.guildId,channel_id:this.channelId,
      consented_user_ids:[...this.consents],duration_ms:this.durationMs,retention_days:this.retentionDays,segments};
  }
}
export function wav(pcm) {
  const header=Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length+36,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22);
  header.writeUInt32LE(RATE,24); header.writeUInt32LE(RATE*2,28); header.writeUInt16LE(2,32);
  header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}
