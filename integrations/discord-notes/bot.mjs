import {Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits} from 'discord.js';
import {joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType} from '@discordjs/voice';
import OpusScript from 'opusscript';
import {readFile, mkdtemp, writeFile, rm, stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Session, MAX_MS} from './session.mjs';

const configPath='/app/.data/discord-voice/config.json';
if((await stat(configPath)).size>65536) throw Error('Invalid bot configuration.');
const config=JSON.parse(await readFile(configPath,'utf8'));
const snowflake=s=>typeof s==='string' && /^[1-9][0-9]{15,19}$/.test(s) && BigInt(s)<2n**64n;
if(!snowflake(config.guild_id) || !Array.isArray(config.operator_ids) || !config.operator_ids.length || !config.operator_ids.every(snowflake) || !Array.isArray(config.case_ids) || !config.case_ids.every(s=>/^RR-[a-f0-9]{32}$/.test(s)) || typeof config.token!=='string') throw Error('Configure the local Discord bot first.');
const retentionDays=Number(process.env.RELAY_DISCORD_RETENTION_DAYS||7);
if(![1,7,30].includes(retentionDays)) throw Error('Retention must be 1, 7 or 30 days.');
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates],allowedMentions:{parse:[]}});
let active=null, busy=false;
async function api(method,path,body) {
  const response=await fetch('http://127.0.0.1:8178/api/v1'+path,{method,redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok) throw Error('Repro did not confirm this request.');
  const text=await response.text(); if(text.length>1_000_000) throw Error('Response too large.'); return JSON.parse(text);
}
const members=channel=>[...channel.members.values()].filter(m=>!m.user.bot).map(m=>m.id);
function controls(session,recording=false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`consent:${session.id}`).setLabel('I consent').setStyle(ButtonStyle.Primary).setDisabled(recording),
    new ButtonBuilder().setCustomId(`finish:${session.id}`).setLabel('Stop and share with Hermes').setStyle(ButtonStyle.Success).setDisabled(!recording),
    new ButtonBuilder().setCustomId(`cancel:${session.id}`).setLabel('Cancel and discard').setStyle(ButtonStyle.Danger))];
}
function stopAudio(session) {
  for(const stream of session.streams||[]) stream.destroy();
  session.streams=[];
  if(session.connection && session.connection.state.status!==VoiceConnectionStatus.Destroyed) session.connection.destroy();
  if(session.timer) clearTimeout(session.timer);
  if(session.linked && !session.endedReceipt) {
    session.endedReceipt={id:randomUUID(),call_id:session.id,guild_id:session.guildId,channel_id:session.channelId,actor_id:session.actorId,status:'left'};
    void api('POST',`/cases/${session.caseId}/discord-calls`,session.endedReceipt).catch(()=>console.error('Call-end receipt was not confirmed by Repro.'));
  }
}
async function cancel(session,reason) {
  session.cancel(); stopAudio(session); session.child?.kill('SIGTERM');
  if(active===session) active=null;
  try { await session.notice?.edit({content:`Call notes cancelled. ${reason} Captured audio was discarded; no transcript will be shared.`,components:[]}); } catch {}
}
function decode(session,channel) {
  for(const id of session.members) {
    const decoder=new OpusScript(48000,2,OpusScript.Application.AUDIO);
    const stream=session.connection.receiver.subscribe(id,{end:{behavior:EndBehaviorType.Manual}});
    session.streams.push(stream);
    stream.on('data',packet=>{
      if(session.state!=='recording') return;
      if(!session.roster(members(channel))) { void cancel(session,'Participants changed. Start again with fresh consent.'); return; }
      try { session.pcm(id,decoder.decode(packet)); if(session.state==='cancelled') void cancel(session,'The capture limit was reached.'); }
      catch { void cancel(session,'Audio could not be decoded.'); }
    });
    stream.on('error',()=>void cancel(session,'The voice connection failed.'));
    stream.once('close',()=>decoder.delete());
  }
}
async function begin(session,channel) {
  if(!session.roster(members(channel))) throw Error('Participants changed.');
  clearTimeout(session.timer); session.start();
  await session.notice.edit({content:`RECORDING FOR CALL NOTES. Everyone consented. Local transcription; Team retains the transcript and reply for ${retentionDays} days. Hermes and its model provider have separate retention policies. Stop and share before ten minutes, or cancel to discard.`,components:controls(session,true)});
  if(session.state!=='recording') return;
  session.connection.rejoin({selfDeaf:false,selfMute:true});
  await entersState(session.connection,VoiceConnectionStatus.Ready,20_000);
  if(session.state!=='recording') { stopAudio(session); return; }
  decode(session,channel);
  session.timer=setTimeout(()=>void cancel(session,'Ten-minute limit reached without a share request.'),MAX_MS);
}
async function finish(session) {
  const audio=session.finish(); stopAudio(session);
  let directory;
  try {
    await session.notice.edit({content:'Capture stopped. Transcribing locally, then requesting a Hermes summary in Repro Team. Cancel can still discard before submission.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cancel:${session.id}`).setLabel('Cancel and discard').setStyle(ButtonStyle.Danger))]});
    if(!audio.length) throw Error('No speech packets were captured.');
    directory=await mkdtemp('/tmp/relay-notes-');
    for(const item of audio) await writeFile(`${directory}/${item.speaker}.wav`,item.audio,{mode:0o600});
    await writeFile(`${directory}/manifest.json`,JSON.stringify(audio.map(x=>x.speaker)),{mode:0o600});
    if(session.state!=='processing') return;
    const output=await new Promise((resolve,reject)=>{
      session.child=execFile('/opt/speech/bin/python',['/app/integrations/discord-notes/transcribe.py',directory],{timeout:300_000,maxBuffer:256_000},(error,stdout)=>error?reject(Error('Local transcription failed.')):resolve(stdout));
    });
    if(session.state!=='processing') return;
    const segments=JSON.parse(output);
    const payload=session.payload(segments);
    // A deliberate Stop and share authorizes this one request. Same ID on uncertain retries.
    session.state='submitting';
    await session.notice.edit({content:'Submitting the transcript to Repro Team. Cancellation is no longer available for this submission.',components:[]});
    let receipt;
    for(let attempt=0;attempt<3;attempt++) {
      try { receipt=await api('POST',`/cases/${session.caseId}/discord-notes`,payload); break; }
      catch { if(attempt===2) throw Error('Repro did not confirm receipt. Check Team before retrying; no success is assumed.'); }
    }
    if(!receipt?.saved) throw Error('Repro did not confirm receipt.');
    session.state='submitted';
    await session.notice.edit({content:`Transcript saved in Repro Team for ${session.caseId}. Hermes is queued; this is not confirmation of a model reply. Raw audio discarded.`,components:[]});
  } catch(error) {
    if(session.state!=='cancelled') await session.notice.edit({content:`Call notes did not finish: ${error.message} No successful Hermes reply is claimed.`,components:[]}).catch(()=>{});
  } finally {
    session.clear(); for(const item of audio) item.audio.fill(0);
    if(directory) await rm(directory,{recursive:true,force:true});
    if(active===session) active=null;
  }
}
client.on('voiceStateUpdate',(before,after)=>{
  const session=active;
  if(!session || !['consent','recording'].includes(session.state)) return;
  if(before.channelId===session.channelId || after.channelId===session.channelId) {
    const channel=client.channels.cache.get(session.channelId);
    if(!channel || (after.id===client.user.id && after.channelId!==session.channelId) || !session.roster(members(channel))) void cancel(session,'The call membership or bot connection changed.');
  }
});
client.on('interactionCreate',async interaction=>{
  if(!interaction.isChatInputCommand() && !interaction.isButton()) return;
  try {
    if(interaction.guildId!==config.guild_id) { await interaction.reply({content:'This server is not configured.',ephemeral:true}); return; }
    if(interaction.isButton()) {
      const [action,id]=interaction.customId.split(':'); const session=active;
      if(!session || session.id!==id || !session.members.has(interaction.user.id)) { await interaction.reply({content:'This consent request is not active for you.',ephemeral:true}); return; }
      if(action==='cancel' && ['consent','recording','processing'].includes(session.state)) { await interaction.deferUpdate(); await cancel(session,'A participant withdrew consent.'); return; }
      if(busy) { await interaction.reply({content:'A call transition is in progress. Try again shortly.',ephemeral:true}); return; }
      await interaction.deferUpdate(); busy=true;
      try {
        if(action==='consent') {
          if(interaction.member.voice.channelId!==session.channelId) throw Error('Return to the call to consent.');
          if(session.consent(interaction.user.id)) await begin(session,interaction.member.voice.channel);
          else await session.notice.edit({content:`Waiting for consent: ${session.consents.size}/${session.members.size}. Stop and share sends the local transcript to Hermes and the Repro team. Team retention ${retentionDays} days; Hermes and provider retention is separate. No audio captured yet.`,components:controls(session)});
        } else if(action==='finish' && session.state==='recording' && config.operator_ids.includes(interaction.user.id)) { void finish(session); }
      } finally { busy=false; }
      return;
    }
    if(interaction.commandName!=='repro_notes') return;
    const caseId=interaction.options.getString('work_id',true);
    if(!config.operator_ids.includes(interaction.user.id) || !config.case_ids.includes(caseId)) { await interaction.reply({content:'This operator or work ID is not authorized.',ephemeral:true}); return; }
    if(active || busy) { await interaction.reply({content:'Finish or cancel the current call first.',ephemeral:true}); return; }
    const channel=interaction.member.voice.channel;
    if(!channel || channel.type!==2) { await interaction.reply({content:'Join a standard voice channel first.',ephemeral:true}); return; }
    if(!channel.permissionsFor(client.user).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.SendMessages])) { await interaction.reply({content:'The bot needs View Channel, Connect and Send Messages in the voice channel.',ephemeral:true}); return; }
    await interaction.deferReply({ephemeral:true}); busy=true;
    try {
      await api('GET',`/cases/${caseId}`);
      const session=new Session({members:members(channel),caseId,guildId:config.guild_id,channelId:channel.id,actorId:interaction.user.id,retentionDays}); active=session;
      session.streams=[];
      session.connection=joinVoiceChannel({channelId:channel.id,guildId:config.guild_id,adapterCreator:interaction.guild.voiceAdapterCreator,selfDeaf:true,selfMute:true});
      session.connection.on('error',()=>void cancel(session,'Voice connection error.'));
      session.connection.on(VoiceConnectionStatus.Disconnected,()=>void cancel(session,'Voice connection lost.'));
      await entersState(session.connection,VoiceConnectionStatus.Ready,20_000);
      if(active!==session) throw Error('Call was cancelled.');
      await api('POST',`/cases/${caseId}/discord-calls`,{id:randomUUID(),call_id:session.id,guild_id:config.guild_id,channel_id:channel.id,actor_id:interaction.user.id,status:'joined'});
      session.linked=true;
      if(active!==session || session.state!=='consent') { stopAudio(session); throw Error('Call was cancelled.'); }
      session.notice=await channel.send({content:`Call notes for ${caseId}. Each of ${session.members.size} participants must consent. Speech will be transcribed locally. Stop and share sends the transcript to your configured Hermes model and shared Repro Team chat. Team retention ${retentionDays} days; Hermes and provider retention is separate. Raw audio is discarded. No recording before everyone agrees. Maximum ten minutes. An authorized operator must stop and share; anyone can cancel.`,components:controls(session)});
      if(active!==session || session.state!=='consent') { await cancel(session,'The call changed during setup.'); throw Error('Call was cancelled.'); }
      session.timer=setTimeout(()=>void cancel(session,'Consent request expired.'),120_000);
      await interaction.editReply('Consent controls are in the voice channel chat. No audio is captured yet.');
    } catch(error) { if(active) await cancel(active,'Setup failed.'); throw error; }
    finally { busy=false; }
  } catch { if(interaction.deferred || interaction.replied) await interaction.followUp({content:'The operation did not complete. Check Repro and bot permissions. No success is assumed.',ephemeral:true}).catch(()=>{}); else await interaction.reply({content:'The operation did not complete.',ephemeral:true}).catch(()=>{}); }
});
client.once('clientReady',async()=>{
  console.log(`Invite: https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=1051648&guild_id=${config.guild_id}`);
  try {
    await new REST().setToken(config.token).put(Routes.applicationGuildCommands(client.user.id,config.guild_id),{body:[new SlashCommandBuilder().setName('repro_notes').setDescription('Request consent for local call notes and a Hermes Team summary.').addStringOption(x=>x.setName('work_id').setDescription('Approved Repro work ID').setRequired(true)).toJSON()]});
    console.log('Call notes bot connected. Use /repro_notes. Capture still requires every participant to consent.');
  } catch { console.error('Invite the bot, then restart it to register the call-notes command.'); await client.destroy(); process.exitCode=1; }
});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{ if(active) { active.cancel(); stopAudio(active); active.child?.kill(); } client.destroy(); process.exit(0); });
process.on('unhandledRejection',()=>{ console.error('Call notes stopped after an unexpected error. No success is assumed.'); if(active) { active.cancel(); stopAudio(active); active.child?.kill(); } client.destroy(); process.exitCode=1; });
await client.login(config.token).catch(()=>{console.error('Discord login failed. Check the private bot token.'); process.exitCode=1;});
