'use strict';
// PeerJS owns WebRTC negotiation/NAT traversal. The host alone advances the game;
// guests send bounded controls and render the resulting state.
const ROOM_VERSION=3,ROOM_PREFIX='bubble-arena-v3-',ROOM_ALPHABET='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const safeName=value=>String(value||'玩家').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,16)||'玩家';
const roomCode=value=>String(value||'').trim().toUpperCase().replace(/\s/g,'');
const validRoom=code=>/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(code);
function validateNetworkState(s){
  if(!s||typeof s!=='object'||!['playing','paused','result'].includes(s.phase)||!Number.isSafeInteger(s.matchId)||!Number.isFinite(s.tick)||!Number.isFinite(s.remaining))return null;
  if(!s.options||s.options.mode!=='online'||!['versus','coop'].includes(s.options.match)||!['easy','normal','hard'].includes(s.options.difficulty)||!['candy','ice','garden'].includes(s.options.theme))return null;
  if(!Array.isArray(s.map)||s.map.length!==ROWS||s.map.some(row=>!Array.isArray(row)||row.length!==COLS||row.some(cell=>![0,1,2].includes(cell))))return null;
  if(!Array.isArray(s.players)||s.players.length<2||s.players.length>4)return null;
  const fields=['id','x','y','char','range','capacity','speed','activeBombs','score','shield','lives','dir','renderX','renderY','invulnerable','frozenUntil'];
  const players=[];for(const [id,p] of s.players.entries()){
    if(!p||p.id!==id||!Number.isInteger(p.char)||p.char<0||p.char>3||fields.some(f=>!Number.isFinite(p[f]))||p.x<0||p.x>=COLS||p.y<0||p.y>=ROWS||p.renderX<0||p.renderX>832||p.renderY<0||p.renderY>616||typeof p.alive!=='boolean')return null;
    const clean={};for(const f of fields)clean[f]=p[f];players.push({...clean,human:!!p.human,name:p.name?safeName(p.name):null,alive:p.alive});
  }
  const bounded=(values,max,kinds)=>Array.isArray(values)&&values.length<=max&&values.every(v=>v&&Number.isInteger(v.x)&&Number.isInteger(v.y)&&v.x>=0&&v.x<COLS&&v.y>=0&&v.y<ROWS&&kinds.includes(v.kind||v.type));
  if(!bounded(s.bombs,128,['bomb','mine','gas','grenade'])||!bounded(s.flames,256,['fire','ice','gas'])||!bounded(s.items,195,['bomb','fire','speed','shield','glove','life','flame','ice','gas','grenade','mine','rocket'])||!bounded(s.projectiles,32,['flame','ice','rocket']))return null;
  return {matchId:s.matchId,phase:s.phase,round:Number.isSafeInteger(s.round)?s.round:1,tick:s.tick,remaining:Math.max(0,s.remaining),options:{mode:'online',match:s.options.match,difficulty:s.options.difficulty,theme:s.options.theme,character:0},map:s.map.map(r=>[...r]),players,
    bombs:s.bombs.map(b=>({id:b.id,x:b.x,y:b.y,owner:b.owner,kind:b.kind})),flames:s.flames.map(f=>({x:f.x,y:f.y,owner:f.owner,kind:f.kind})),items:s.items.map(i=>({x:i.x,y:i.y,type:i.type})),projectiles:s.projectiles.map(p=>({x:p.x,y:p.y,owner:p.owner,kind:p.kind})),audit:Object.fromEntries(['bombsPlaced','explosions','boxesDestroyed','pickups','chainReactions','deaths'].map(k=>[k,Number.isFinite(s.audit?.[k])?s.audit[k]:0])),winnerId:Number.isInteger(s.winnerId)?s.winnerId:null,lastWon:!!s.lastWon,finished:!!s.finished};
}
class OnlineRoom {
  constructor(){this.active=false;this.isHost=false;this.localId=0;this.members=[];this.connections=new Map();this.inputs=new Map();this.sequence=0;this.matchId=0;this.matchStarted=false;this.pendingState=null;this.lastState=0;this.lastInput=0;this.lastBroadcast=0;this.lastPump=performance.now();
    this.timer=setInterval(()=>this.pump(),33);window.addEventListener('keyup',()=>this.releaseInput());
    $('create-room').addEventListener('click',()=>this.create());$('join-room').addEventListener('click',()=>this.join());$('ready-button').addEventListener('click',()=>this.ready());$('launch-room').addEventListener('click',()=>this.startMatch());
    ['copy-invite','room-invite'].forEach(id=>$(id).addEventListener('click',()=>this.copyInvite()));['leave-lobby','room-leave'].forEach(id=>$(id).addEventListener('click',()=>{this.leave();showMenu();}));
    $('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')this.join();});
    const invited=new URLSearchParams(location.search).get('room');if(invited){selectMode('online');$('room-code').value=roomCode(invited);this.status('好友邀请你加入房间 '+roomCode(invited)+'，填写昵称后点击加入。');}
  }
  status(message,error=false){$('online-status').textContent=message;$('online-status').classList.toggle('error',error);}
  lock(busy){$('create-room').disabled=busy;$('join-room').disabled=busy;}
  newCode(){const bytes=crypto.getRandomValues(new Uint8Array(10));return [...bytes].map(b=>ROOM_ALPHABET[b%ROOM_ALPHABET.length]).join('');}
  makePeer(id){if(!window.Peer)throw new Error('联机组件未能加载，请刷新页面。');return id?new Peer(id,{debug:0}):new Peer({debug:0});}
  async create(){if(this.active)return;this.closePeer();this.lock(true);this.status('正在创建房间…');this.code=this.newCode();this.isHost=true;this.localId=0;this.matchStarted=false;
    try{const peer=this.peer=this.makePeer(ROOM_PREFIX+this.code);this.listenPeer(peer);peer.on('open',()=>{if(this.peer!==peer)return;this.active=true;this.lock(false);this.members=[{peer:peer.id,name:safeName($('online-name').value||'房主'),character:options.character,ready:true}];options.match=$('online-rule').value;this.showLobby();this.status('房间已创建，复制链接邀请好友。');});peer.on('connection',conn=>this.accept(conn));this.connectionDeadline(peer);}catch(error){this.lock(false);this.status(error.message,true);}
  }
  async join(){if(this.active)return;const code=roomCode($('room-code').value);if(!validRoom(code)){this.status('请输入完整的 10 位房间号。',true);return;}this.closePeer();this.lock(true);this.status('正在连接好友房间…');this.code=code;this.isHost=false;this.matchStarted=false;this.lastStateRevision=-1;
    try{const peer=this.peer=this.makePeer();this.listenPeer(peer);peer.on('open',()=>{if(this.peer!==peer)return;const conn=this.hostConnection=peer.connect(ROOM_PREFIX+code,{serialization:'json',reliable:true,metadata:{version:ROOM_VERSION,name:safeName($('online-name').value),character:options.character}});conn.on('data',data=>this.guestMessage(data));conn.on('close',()=>this.lostHost(conn));conn.on('error',()=>this.status('连接中断，可以退出房间后重新加入。',true));conn.on('open',()=>{if(this.peer===peer)this.status('已连接，正在进入房间…');});});this.connectionDeadline(peer);}catch(error){this.lock(false);this.status(error.message,true);}
  }
  connectionDeadline(peer){clearTimeout(this.deadline);this.deadline=setTimeout(()=>{if(this.peer===peer&&!this.active){this.closePeer();this.lock(false);this.status('连接超时。请确认房主页面仍打开，并检查双方网络。',true);}},18000);}
  listenPeer(peer){peer.on('error',error=>{if(this.peer!==peer)return;const labels={'peer-unavailable':'房间不存在或房主已离开。','unavailable-id':'房间号被占用，请重新创建。','network':'联机服务暂时连不上，请稍后重试。','browser-incompatible':'当前浏览器不支持联机，请用新版 Chrome、Edge 或 Safari。'};this.status(labels[error.type]||'连接失败，请检查网络后重新创建或加入。',true);if(!this.active){this.closePeer();this.lock(false);}});peer.on('disconnected',()=>{if(this.peer===peer&&this.active){$('connection-status').textContent='房间目录连接中断';this.status('房间目录连接中断，已有连接仍可继续。');}});}
  accept(conn){if(!this.active||!this.isHost){conn.close();return;}conn.on('open',()=>{
      const meta=conn.metadata||{},limit=options.match==='coop'?2:4;
      if(this.matchStarted&&arena.phase==='result')this.members=this.members.filter(m=>m.peer===this.peer.id||this.connections.has(m.peer));
      let reject=meta.version!==ROOM_VERSION?'游戏版本不同，请刷新后加入。':this.matchStarted&&arena.phase!=='result'?'对局已开始，等下一局再加入。':this.members.length>=limit?'房间已经满员。':null;
      if(reject){conn.send({kind:'reject',reason:reject});setTimeout(()=>conn.close(),150);return;}
      if(this.matchStarted&&arena.phase==='result'){this.matchStarted=false;this.members=this.members.filter(m=>m.peer===this.peer.id||this.connections.has(m.peer));arena.phase='menu';$('result-overlay').hidden=true;$('menu').hidden=false;}
      let character=Number.isInteger(meta.character)&&meta.character>=0&&meta.character<4?meta.character:0;if(this.members.some(m=>m.character===character))character=[0,1,2,3].find(c=>!this.members.some(m=>m.character===c));
      this.connections.set(conn.peer,conn);this.members.push({peer:conn.peer,name:safeName(meta.name),character,ready:false});this.broadcastLobby();this.status('好友加入了，等大家准备好即可开始。');
    });conn.on('data',data=>this.hostMessage(conn,data));conn.on('close',()=>this.removeGuest(conn));conn.on('error',()=>this.removeGuest(conn));
  }
  hostMessage(conn,message){if(!this.connections.has(conn.peer)||!message||typeof message!=='object')return;const id=this.members.findIndex(m=>m.peer===conn.peer);if(id<1)return;
    if(message.kind==='ready'&&!this.matchStarted){this.members[id].ready=!!message.ready;this.broadcastLobby();}
    if(message.kind==='ping')this.send(conn,{kind:'pong',sent:message.sent});
    if(message.kind==='input'&&this.matchStarted&&arena.phase==='playing'){
      if(!Number.isSafeInteger(message.sequence)||message.sequence<0||!Number.isInteger(message.direction)||message.direction< -1||message.direction>3||typeof message.bomb!=='boolean')return;
      const old=this.inputs.get(id);if(old&&message.sequence<=old.sequence)return;const now=performance.now();if(old&&now-old.received<15&&message.direction>=0&&!message.bomb)return;
      this.inputs.set(id,{direction:message.direction,sequence:message.sequence,received:now});const p=arena.players[id];if(!p?.alive)return;if(message.direction>=0)arena.tryMove(p,message.direction);if(message.bomb)arena.placeBomb(p);
    }
  }
  guestMessage(message){if(!message||typeof message!=='object')return;
    if(message.kind==='reject'){this.status(String(message.reason).slice(0,120),true);this.rejected=true;this.lock(false);return;}
    if(message.kind==='lobby'){
      if(!Array.isArray(message.members)||message.members.length>4||!Number.isInteger(message.localId))return;this.active=true;this.matchStarted=false;this.localId=message.localId;this.members=message.members.map(m=>({name:safeName(m.name),character:m.character,ready:!!m.ready}));options.match=message.match;clearTimeout(this.deadline);this.lock(false);this.showLobby();this.status('已加入房间，准备后等房主开始。');
    }
    if(message.kind==='state'&&Number.isSafeInteger(message.revision)&&message.revision>this.lastStateRevision){const state=validateNetworkState(message.state);if(!state)return;this.active=true;this.matchStarted=true;this.matchId=state.matchId;this.lastState=performance.now();this.lastStateRevision=message.revision;this.pendingState=state;this.updateBar();}
    if(message.kind==='pong'&&Number.isFinite(message.sent)){this.latency=Math.round(performance.now()-message.sent);this.updateBar();}
  }
  broadcastLobby(){this.showLobby();for(const [peer,conn] of this.connections)this.send(conn,{kind:'lobby',localId:this.members.findIndex(m=>m.peer===peer),members:this.members.map(({name,character,ready})=>({name,character,ready})),match:options.match});}
  showLobby(){clearTimeout(this.deadline);if(!this.matchStarted){$('menu').hidden=false;$('result-overlay').hidden=true;}$('room-entry').hidden=true;$('room-lobby').hidden=false;$('lobby-code').textContent=this.code;$('invite-link').value=this.inviteLink();$('ready-button').hidden=this.isHost;$('launch-room').hidden=!this.isHost;
    $('difficulty').disabled=!this.isHost;$('theme').disabled=!this.isHost;document.querySelectorAll('[data-character]').forEach(b=>b.disabled=true);$('online-name').disabled=true;
    $('lobby-members').innerHTML=this.members.map((member,id)=>`<div class="lobby-member"><span class="member-color" style="background:#${COLORS[member.character]?.toString(16)||'79bfff'}"></span><strong>${escapeHtml(member.name)}${id===this.localId?' · 你':''}</strong><small>${id===0?'房主':member.ready?'已准备':'未准备'}</small></div>`).join('');
    const mine=this.members[this.localId];$('ready-button').disabled=false;$('ready-button').textContent=mine?.ready?'取消准备':'准备';$('launch-room').disabled=this.members.length<2||!this.members.every(m=>m.ready);$('launch-room').textContent=this.members.length<2?'等待好友加入':'开始对局';this.updateBar();
  }
  inviteLink(){const url=new URL(location.href);url.search='';url.searchParams.set('room',this.code);url.hash='';return url.href;}
  async copyInvite(){try{await navigator.clipboard.writeText(this.inviteLink());this.status('邀请链接已复制。');$('connection-status').textContent='邀请链接已复制';}catch{$('invite-link').focus();$('invite-link').select();this.status('请复制上方邀请链接发给好友。');}}
  ready(){if(!this.active||this.isHost)return;const mine=this.members[this.localId];this.send(this.hostConnection,{kind:'ready',ready:!mine?.ready});}
  startMatch(){if(!this.active||!this.isHost)return;this.members=this.members.filter(m=>m.peer===this.peer.id||this.connections.has(m.peer));if(this.members.length<2){this.matchStarted=false;this.broadcastLobby();this.status('需要至少两位玩家，邀请好友加入后再开始。');return;}if(!this.matchStarted&&!this.members.every(m=>m.ready))return;this.broadcastLobby();this.matchStarted=true;this.matchId++;this.lastPump=performance.now();this.inputs.clear();options.mode='online';arena.startRound(this.matchId===1);$('menu').hidden=true;this.updateBar();this.broadcastState();}
  heldDirection(){if(!arena?.keys)return -1;const k=arena.keys,t=arena.touch;return k.UP.isDown||k.W.isDown||t.has('up')?0:k.RIGHT.isDown||k.D.isDown||t.has('right')?1:k.DOWN.isDown||k.S.isDown||t.has('down')?2:k.LEFT.isDown||k.A.isDown||t.has('left')?3:-1;}
  keyInput(event){const dirs={ArrowUp:0,KeyW:0,ArrowRight:1,KeyD:1,ArrowDown:2,KeyS:2,ArrowLeft:3,KeyA:3};if(event.code in dirs){this.lastDirection=dirs[event.code];this.sendInput(dirs[event.code],false);}else if(event.code==='Space'&&!event.repeat)this.sendInput(-1,true);}
  sendInput(direction,bomb){if(!this.active||!this.matchStarted||arena?.phase!=='playing')return;if(this.isHost){const p=arena.players[0];if(direction>=0)arena.tryMove(p,direction);if(bomb)arena.placeBomb(p);return;}this.send(this.hostConnection,{kind:'input',sequence:++this.sequence,direction,bomb:!!bomb});}
  pollInput(){if(!this.active||this.isHost||!this.matchStarted||arena?.phase!=='playing')return;const now=performance.now(),direction=this.heldDirection();if(now-this.lastInput>80&&(direction>=0||this.lastDirection>=0)){this.lastInput=now;this.lastDirection=direction;this.sendInput(direction,false);}}
  playerInput(p){if(this.isHost&&p.id===0){const direction=this.heldDirection();if(direction>=0)arena.tryMove(p,direction);}else{const input=this.inputs.get(p.id);if(input&&performance.now()-input.received<260&&input.direction>=0)arena.tryMove(p,input.direction);}}
  releaseInput(){if(this.active&&!this.isHost&&this.lastDirection>=0)this.sendInput(-1,false);this.lastDirection=-1;}
  pump(){const now=performance.now();let elapsed=Math.min(1000,now-this.lastPump);this.lastPump=now;if(!this.active)return;if(this.isHost&&this.matchStarted){while(elapsed>0&&arena?.phase==='playing'){const step=Math.min(50,elapsed);arena.update(now,step,true);elapsed-=step;}if(now-this.lastBroadcast>=66){this.lastBroadcast=now;this.broadcastState();}}
    if(!this.isHost&&this.hostConnection?.open&&now-(this.lastPing||0)>2000){this.lastPing=now;this.send(this.hostConnection,{kind:'ping',sent:now});}
    if(!this.isHost&&this.matchStarted&&now-this.lastState>8000)$('connection-status').textContent='等待房主同步…';
  }
  broadcastState(){if(!this.matchStarted||!arena||!['playing','paused','result'].includes(arena.phase))return;const message={kind:'state',revision:++this.sequence,state:arena.networkState()};for(const conn of this.connections.values())if((conn.dataChannel?.bufferedAmount||0)<65536)this.send(conn,message);}
  send(conn,message){if(conn?.open)try{conn.send(message);}catch{this.status('连接中断，请退出房间后重新连接。',true);}}
  updateBar(){$('room-summary').textContent='房间 '+this.code+' · '+this.members.length+' 人 · '+(this.isHost?'你是房主':'你是玩家 '+(this.localId+1));$('connection-status').textContent=this.isHost?'房主同步中':this.latency===undefined?'联机中':'连接正常 · '+this.latency+'ms';}
  removeGuest(conn){if(!this.connections.has(conn.peer))return;const id=this.members.findIndex(m=>m.peer===conn.peer),name=this.members[id]?.name;this.connections.delete(conn.peer);this.inputs.delete(id);
    if(this.matchStarted){const p=arena.players[id];if(p){p.alive=false;p.move=null;p.sprite.setAlpha(.25);p.ring.setVisible(false);}this.status((name||'好友')+' 离开了房间。');$('status-line').textContent=(name||'好友')+' 离开了房间。';}
    else{this.members.splice(id,1);this.broadcastLobby();this.status('好友离开了，邀请另一位好友加入即可。');}
  }
  lostHost(conn){if(conn!==this.hostConnection)return;this.active=false;this.matchStarted=false;this.lock(false);if(arena)arena.phase='menu';$('menu').hidden=false;$('result-overlay').hidden=true;$('pause-overlay').hidden=true;$('room-bar').hidden=true;$('launch-room').disabled=true;$('ready-button').disabled=true;this.status(this.rejected?'房间未能加入，请退出后重试。':'房主离开或连接中断，请退出房间后重新加入。',true);}
  closePeer(){clearTimeout(this.deadline);const peer=this.peer;this.peer=null;peer?.destroy();this.hostConnection=null;this.rejected=false;}
  leave(){this.active=false;this.matchStarted=false;this.closePeer();this.connections.clear();this.inputs.clear();this.members=[];this.pendingState=null;this.netRound=null;$('room-entry').hidden=false;$('room-lobby').hidden=true;$('room-bar').hidden=true;$('difficulty').disabled=false;$('theme').disabled=false;$('online-name').disabled=false;$('ready-button').disabled=false;document.querySelectorAll('[data-character]').forEach(b=>b.disabled=false);this.lock(false);this.status('已退出房间，可以重新创建或加入。');}
  snapshot(){return {active:this.active,host:this.isHost,code:this.code,localId:this.localId,memberCount:this.members.length,members:this.members.map(({name,character,ready})=>({name,character,ready})),matchStarted:this.matchStarted,matchId:this.matchId,connectionOpen:!!this.hostConnection?.open,receivedRevision:this.lastStateRevision??null};}
}
net=new OnlineRoom();window.bubbleOnline={snapshot:()=>net.snapshot()};
