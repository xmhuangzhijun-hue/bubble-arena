'use strict';
const TILE = 44, COLS = 15, ROWS = 13, OX = 86, OY = 22;
const COLORS = [0x40c8f4, 0xff70ba, 0xffaa38, 0xa4dc3a];
const CHAR_NAMES = ['蓝蓝', '桃桃', '柠柠', '绿豆'];
const CHAR_FRAMES = ['blue', 'pink', 'orange', 'green'];
const FRAME_DATA = [
  ['pink-down',25,6,265,314],['blue-down',337,4,267,316],['green-down',651,6,286,314],['orange-down',962,0,267,320],
  ['pink-up',25,320,266,313],['blue-up',337,320,264,315],['green-up',653,320,266,313],['orange-up',962,320,268,316],
  ['bomb',40,641,223,296],['candy-wall',349,660,252,259],['biscuit-crate',656,660,252,261],['cupcake',973,657,251,278],
  ['power-bomb',26,956,263,266],['power-fire',339,954,263,268],['power-speed',655,956,263,268],['power-shield',966,954,261,264]
];
const $ = id => document.getElementById(id);
const options = { mode: 'solo', difficulty: 'normal', theme: 'candy', character: 0, match: 'versus' };
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];
const key = (x,y) => x + ',' + y;
const point = (x,y) => ({ x: OX+x*TILE+TILE/2, y: OY+y*TILE+TILE/2 });
let arena, net, soundEnabled = false, audioContext;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function tone(freq=440,duration=.08,type='sine',volume=.06) {
  if (!soundEnabled) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35,freq/3),audioContext.currentTime+duration);
    gain.gain.setValueAtTime(volume,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+duration);
  } catch (_) { /* Audio is optional. */ }
}
class Arena extends Phaser.Scene {
  constructor(){super('arena');this.phase='menu';this.round=1;this.tick=0;this.players=[];this.bombs=[];this.flames=[];this.projectiles=[];this.items=new Map();this.map=[];this.touch=new Set();this.audit={bombsPlaced:0,explosions:0,boxesDestroyed:0,pickups:0,chainReactions:0,deaths:0};}
  preload(){this.load.image('atlas','assets/atlas.png');}
  create(){
    arena=this;
    for(const [name,x,y,w,h] of FRAME_DATA)this.textures.get('atlas').add(name,0,x,y,w,h);
    this.mapLayer=this.add.container();this.entityLayer=this.add.container();this.effectsLayer=this.add.container();
    this.keys=this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,ENTER,P,ESC');
    this.input.keyboard.addCapture(['UP','DOWN','LEFT','RIGHT','SPACE','ENTER']);
    this.input.keyboard.on('keydown-P',()=>this.togglePause());this.input.keyboard.on('keydown-ESC',()=>this.togglePause());
    this.input.keyboard.on('keydown',event=>{
      if(this.phase!=='playing')return;
      if(net?.active){net.keyInput(event);return;}
      const code=event.code||event.key;
      for(const p of this.players.filter(p=>p.human&&p.alive)){
        const moveKeys=options.mode==='duo'&&p.id===0?['KeyW','KeyD','KeyS','KeyA']:['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'];
        const direction=moveKeys.indexOf(code);if(direction!==-1)this.tryMove(p,direction);
        if(code===(p.id===1?'Enter':'Space'))this.placeBomb(p);
      }
    });
    this.makeMap(378);this.drawMap();
    this.scale.on('resize',()=>{});
    this.game.events.on('blur',()=>{if(this.phase==='playing'&&!net?.active)this.setPaused(true);this.touch.clear();net?.releaseInput();});
    $('start').disabled=false;
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  makeMap(seed){
    this.seed=seed>>>0;this.map=[];
    const spawns=[[1,1],[COLS-2,ROWS-2],[COLS-2,1],[1,ROWS-2]];
    for(let y=0;y<ROWS;y++){
      const row=[];
      for(let x=0;x<COLS;x++){
        let tile=(x===0||y===0||x===COLS-1||y===ROWS-1||(x%2===0&&y%2===0))?1:0;
        const safe=spawns.some(([sx,sy])=>Math.abs(x-sx)+Math.abs(y-sy)<=2);
        if(!tile&&!safe&&this.random()<.66)tile=2;
        row.push(tile);
      }this.map.push(row);
    }
  }
  drawMap(){
    this.mapLayer.removeAll(true);this.tiles=new Map();
    const theme=options.theme;
    const palette=theme==='ice'?[0xc9edf9,0xb5dfed,0x78b9cf]:theme==='garden'?[0xcce7aa,0xbddd8b,0x85ad58]:[0xffe8bd,0xffd9a1,0xdbac6b];
    this.cameras.main.setBackgroundColor(theme==='ice'?0xb5dfee:theme==='garden'?0xa4c982:0xf1c18d);
    const floor=this.add.graphics();floor.fillStyle(palette[2]);floor.fillRoundedRect(OX-7,OY-7,COLS*TILE+14,ROWS*TILE+14,15);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      floor.fillStyle(palette[(x+y)%2]);floor.fillRect(OX+x*TILE,OY+y*TILE,TILE,TILE);
      floor.lineStyle(1,palette[2],.17);floor.strokeRect(OX+x*TILE,OY+y*TILE,TILE,TILE);
    }this.mapLayer.add(floor);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(this.map[y][x]){
      const p=point(x,y),tile=this.map[y][x];
      const sprite=this.add.image(p.x,p.y-2,'atlas',tile===1?'candy-wall':((x+y)%3===0?'cupcake':'biscuit-crate')).setDisplaySize(TILE+3,TILE+3);
      if(theme==='ice')sprite.setTint(tile===1?0xa8dfff:0xd5ecff);
      if(theme==='garden'&&tile===1)sprite.setTint(0xc0eda2);
      this.mapLayer.add(sprite);this.tiles.set(key(x,y),sprite);
    }
  }
  startRound(reset=true){
    if(reset)this.round=1;
    this.phase='playing';this.tick=0;this.remaining=180000;this.lastHud=0;this.roundResolved=false;this.bombId=0;
    this.entityLayer.removeAll(true);this.effectsLayer.removeAll(true);this.bombs=[];this.flames=[];this.projectiles=[];this.players=[];this.items=new Map();
    this.makeMap((Date.now()^this.round*8713)>>>0);this.drawMap();
    const spawn=[[1,1],[COLS-2,ROWS-2],[COLS-2,1],[1,ROWS-2]],chosen=net?.active&&net.isHost?net.members.map(m=>m.character):[options.character],chars=[...chosen,...[0,1,2,3].filter(c=>!chosen.includes(c))];
    const online=net?.active&&net.isHost,count=online&&options.match==='versus'?net.members.length:4;
    for(let i=0;i<count;i++){
      const [x,y]=spawn[i],p=point(x,y),human=online?i<net.members.length:i===0||(options.mode==='duo'&&i===1);
      if(online&&human)chars[i]=net.members[i].character;
      const sprite=this.add.image(p.x,p.y-7,'atlas',CHAR_FRAMES[chars[i]]+'-down').setDisplaySize(37,44).setDepth(p.y);
      const ring=this.add.graphics().lineStyle(2,COLORS[chars[i]],.6).strokeEllipse(0,0,31,12);ring.setPosition(p.x,p.y+13);
      this.entityLayer.add([ring,sprite]);
      this.players.push({id:i,x,y,char:chars[i],human,name:online&&human?net.members[i].name:null,alive:true,sprite,ring,move:null,range:1,capacity:1,speed:0,activeBombs:0,score:0,shield:human&&options.difficulty==='easy'?1:0,lives:human?1:0,glove:false,weapon:null,ammo:0,frozenUntil:0,slowUntil:0,invulnerable:60000/35,nextAI:0,lastBomb:-5000,dir:2});
    }
    $('menu').hidden=true;$('pause-overlay').hidden=true;$('result-overlay').hidden=true;$('phase-label').textContent='正在对战';$('mode-label').textContent=online?(options.match==='coop'?'联机合作':'联机对战'):options.mode==='duo'?'双人合作':'单人闯关';
    $('round-label').textContent='ROUND '+String(this.round).padStart(2,'0');$('pause-button').disabled=false;$('p1-keys').textContent=options.mode==='duo'?'W A S D':'↑ ↓ ← →';$('p2-guide').hidden=options.mode!=='duo';$('control-player').textContent=online?'你的角色':'玩家 1';$('pause-guide').textContent=online?'房主暂停':'随时暂停';
    $('touch-controls').hidden=!matchMedia('(pointer:coarse)').matches||options.mode==='duo';
    this.updateHUD();$('game').focus();tone(620,.15);if(online){this.winnerId=null;this.netRound=net.matchId;$('room-bar').hidden=false;$('p1-keys').textContent='↑ ↓ ← → / WASD';$('touch-controls').hidden=!matchMedia('(pointer:coarse)').matches;}
  }
  updateHUD(){
    const seconds=Math.ceil(this.remaining/1000);$('time-label').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    $('players').innerHTML=this.players.map(p=>`<div class="player-row ${p.alive?'':'dead'}"><span class="player-avatar avatar-${p.char}"></span><div class="player-info"><b>${p.name?escapeHtml(p.name)+(net?.localId===p.id?' · 你':''):p.human?'玩家 '+(p.id+1):'电脑 · '+CHAR_NAMES[p.char]}${p.alive?'':' · 出局'}</b><small>💣 ${p.capacity}　🔥 ${p.range}　${p.shield?'🛡':''}${p.glove?'🧤':''}${p.human?' ♥'+p.lives:''}</small></div><span class="player-score">${p.score}</span></div>`).join('');
  }
  setPaused(paused){if(this.phase!=='playing'&&this.phase!=='paused')return;this.phase=paused?'paused':'playing';$('pause-overlay').hidden=!paused;$('phase-label').textContent=paused?'暂停中':'正在对战';this.touch.clear();if(!paused)$('game').focus();}
  togglePause(){if(net?.active&&!net.isHost){$('status-line').textContent='联机对局由房主统一暂停。';return;}if(this.phase==='playing'||this.phase==='paused')this.setPaused(this.phase==='playing');}
  tileAt(x,y){return this.map[y]?.[x]??1;}
  bombAt(x,y){return this.bombs.find(b=>b.x===x&&b.y===y&&!b.removed);}
  stepDuration(p){return (p.slowUntil>this.tick?260:142)-Math.min(p.speed,5)*12;}
  tryMove(p,dir){
    if(!p.alive||p.move||p.frozenUntil>this.tick)return false;
    const [dx,dy]=DIRS[dir],x=p.x+dx,y=p.y+dy;p.dir=dir;
    if(this.tileAt(x,y)!==0)return false;
    const bomb=this.bombAt(x,y);
    if(bomb){if(!p.glove||!this.pushBomb(bomb,dx,dy))return false;}
    p.move={sx:p.x,sy:p.y,x,y,start:this.tick,duration:this.stepDuration(p)};
    p.sprite.setFrame(CHAR_FRAMES[p.char]+(dir===0?'-up':'-down')).setFlipX(dir===3);
    return true;
  }
  pushBomb(bomb,dx,dy){
    let x=bomb.x,y=bomb.y;
    for(let i=0;i<COLS;i++){const nx=x+dx,ny=y+dy;if(this.tileAt(nx,ny)!==0||this.bombAt(nx,ny)||this.players.some(p=>p.alive&&p.x===nx&&p.y===ny))break;x=nx;y=ny;}
    if(x===bomb.x&&y===bomb.y)return false;
    bomb.x=x;bomb.y=y;const pos=point(x,y);bomb.sprite.setPosition(pos.x,pos.y-4);tone(270,.06);return true;
  }
  humanInput(p){
    if(net?.active){net.playerInput(p);return;}
    const wasd=options.mode==='duo'&&p.id===0;
    const list=wasd?[this.keys.W,this.keys.D,this.keys.S,this.keys.A]:[this.keys.UP,this.keys.RIGHT,this.keys.DOWN,this.keys.LEFT];
    const touches=['up','right','down','left'];
    for(let i=0;i<4;i++)if(list[i].isDown||(p.id===0&&this.touch.has(touches[i]))){this.tryMove(p,i);break;}
    const bombKey=p.id===1?this.keys.ENTER:this.keys.SPACE;
    if(Phaser.Input.Keyboard.JustDown(bombKey)||(p.id===0&&this.touch.delete('bomb')))this.placeBomb(p);
  }
  placeBomb(p){
    if(!p.alive||p.move||p.frozenUntil>this.tick||this.tick-p.lastBomb<180)return false;
    if(p.weapon&&p.ammo>0){const used=this.useWeapon(p);if(used)p.lastBomb=this.tick;return used;}
    if(p.activeBombs>=p.capacity||this.bombAt(p.x,p.y))return false;
    const pos=point(p.x,p.y),sprite=this.add.image(pos.x,pos.y-3,'atlas','bomb').setDisplaySize(26,35);
    this.entityLayer.add(sprite);
    const bomb={id:++this.bombId,x:p.x,y:p.y,owner:p.id,due:this.tick+60000/35,range:p.range,sprite,kind:'bomb'};
    this.bombs.push(bomb);p.activeBombs++;p.lastBomb=this.tick;this.audit.bombsPlaced++;tone(340,.07,'square',.025);return true;
  }
  blastCells(bomb){
    const cells=[{x:bomb.x,y:bomb.y}];
    if(bomb.kind==='mine'||bomb.kind==='gas')return cells;
    for(let d=0;d<4;d++){const [dx,dy]=DIRS[d];for(let i=1;i<=bomb.range;i++){const x=bomb.x+dx*i,y=bomb.y+dy*i,t=this.tileAt(x,y);if(t===1)break;cells.push({x,y});if(t===2)break;}}
    return cells;
  }
  dangerMap(extra){
    const timed=this.bombs.filter(b=>b.kind!=='mine'&&b.kind!=='gas');
    const all=extra?[...timed,extra]:timed,due=all.map(b=>b.due),cells=all.map(b=>this.blastCells(b));
    for(let loop=0;loop<all.length;loop++){let changed=false;for(let i=0;i<all.length;i++)for(let j=0;j<all.length;j++)if(i!==j&&due[j]>due[i]&&cells[i].some(c=>c.x===all[j].x&&c.y===all[j].y)){due[j]=due[i];changed=true;}if(!changed)break;}
    const danger=new Map();for(let i=0;i<all.length;i++)for(const c of cells[i]){const k=key(c.x,c.y);danger.set(k,Math.min(danger.get(k)??Infinity,due[i]));}
    for(const f of this.flames)danger.set(key(f.x,f.y),this.tick-1);return danger;
  }
  route(p,goal,danger=this.dangerMap(),extra=null){
    const q=[{x:p.x,y:p.y,path:[]}],seen=new Set([key(p.x,p.y)]);
    for(let at=0;at<q.length&&at<500;at++){
      const node=q[at];if(node.path.length&&goal(node.x,node.y,node.path))return node.path;
      const offset=Math.floor(this.random()*4);
      for(let i=0;i<4;i++){
        const dir=(i+offset)%4,[dx,dy]=DIRS[dir],x=node.x+dx,y=node.y+dy,k=key(x,y);
        if(seen.has(k)||this.tileAt(x,y)!==0||this.bombAt(x,y)||(extra&&extra.x===x&&extra.y===y))continue;
        const arrival=this.tick+(node.path.length+1)*this.stepDuration(p),det= danger.get(k);
        if(det!==undefined&&arrival>=det-180&&arrival<=det+700)continue;
        seen.add(k);q.push({x,y,path:[...node.path,dir]});
      }
    }return null;
  }
  escapeRoute(p,extra=null){const danger=this.dangerMap(extra);return this.route(p,(x,y,path)=>!danger.has(key(x,y))&&path.length<=10,danger,extra);}
  botInput(p){
    if(p.move||p.frozenUntil>this.tick||this.tick<p.nextAI)return;
    p.nextAI=this.tick+(options.difficulty==='hard'?30:options.difficulty==='easy'?140:75);
    const danger=this.dangerMap(),threat= danger.has(key(p.x,p.y));
    if(threat){
      const path=this.escapeRoute(p);if(path){this.tryMove(p,path[0]);return;}
      const dirs=DIRS.map((d,i)=>({i,t:danger.get(key(p.x+d[0],p.y+d[1]))??Infinity})).sort((a,b)=>b.t-a.t);for(const d of dirs)if(this.tryMove(p,d.i))return;return;
    }
    if(p.weapon&&p.ammo&&this.random()<.18)this.placeBomb(p);
    const enemies=this.players.filter(other=>other.alive&&other.human);
    const nearBox=DIRS.some(([dx,dy])=>this.tileAt(p.x+dx,p.y+dy)===2);
    const nearEnemy=enemies.some(other=>Math.abs(other.x-p.x)+Math.abs(other.y-p.y)<=p.range+1);
    if((nearBox||nearEnemy)&&p.activeBombs<p.capacity&&this.tick-p.lastBomb>900){
      const extra={x:p.x,y:p.y,range:p.range,due:this.tick+60000/35},escape=this.escapeRoute(p,extra);
      if(escape&&this.random()<(options.difficulty==='easy'?.35:.78)){this.placeBomb(p);this.tryMove(p,escape[0]);return;}
    }
    const route=this.route(p,(x,y)=>this.items.has(key(x,y)),danger)||this.route(p,(x,y)=>DIRS.some(([dx,dy])=>this.tileAt(x+dx,y+dy)===2),danger)||this.route(p,(x,y)=>enemies.some(other=>Math.abs(x-other.x)+Math.abs(y-other.y)<=1),danger);
    if(route){this.tryMove(p,route[0]);return;}
    const offset=Math.floor(this.random()*4);for(let i=0;i<4;i++){const d=(i+offset)%4,[dx,dy]=DIRS[d];if(!danger.has(key(p.x+dx,p.y+dy))&&this.tryMove(p,d))break;}
  }
  addFlame(x,y,owner,kind='fire',life=480){
    const k=key(x,y),pos=point(x,y);
    const existing=this.flames.find(f=>f.x===x&&f.y===y&&f.kind===kind);if(existing){existing.until=Math.max(existing.until,this.tick+life);return;}
    const color=kind==='ice'?0x91e5ff:kind==='gas'?0xb4e46b:0xffad3c;
    const halo=this.add.graphics().fillStyle(color,.65).fillRoundedRect(-TILE*.46,-TILE*.46,TILE*.92,TILE*.92,7).setPosition(pos.x,pos.y);
    const sprite=this.add.image(pos.x,pos.y-2,'atlas',kind==='ice'?'power-shield':kind==='gas'?'power-speed':'power-fire').setDisplaySize(34,34).setAlpha(.9);
    this.effectsLayer.add([halo,sprite]);this.flames.push({x,y,owner,kind,until:this.tick+life,halo,sprite});
    if(this.items.has(k)){const item=this.items.get(k);item.sprite.destroy();item.text?.destroy();this.items.delete(k);}
  }
  destroyBox(x,y,owner){
    if(this.tileAt(x,y)!==2)return;this.map[y][x]=0;const k=key(x,y);this.tiles.get(k)?.destroy();this.tiles.delete(k);this.audit.boxesDestroyed++;
    const p=this.players[owner];if(p)p.score+=options.difficulty==='easy'?5:options.difficulty==='hard'?15:10;
    if(this.random()<.65){
      const basic=this.random()<.8,r=this.random()*100;
      const type=basic?(r<1?'life':r<15?'glove':r<40?'bomb':r<50?'shield':r<75?'fire':'speed'):['flame','ice','gas','grenade','mine','rocket'][Math.floor(this.random()*6)];
      this.dropItem(x,y,type);
    }
  }
  dropItem(x,y,type){
    const frame={bomb:'power-bomb',fire:'power-fire',speed:'power-speed',shield:'power-shield',glove:'power-speed',life:'power-shield',flame:'power-fire',ice:'power-shield',gas:'power-speed',grenade:'power-bomb',mine:'power-bomb',rocket:'power-fire'}[type];
    const pos=point(x,y),sprite=this.add.image(pos.x,pos.y,'atlas',frame).setDisplaySize(28,28);
    this.entityLayer.add(sprite);
    const label={glove:'🧤',life:'♥',flame:'火',ice:'冰',gas:'汽',grenade:'榴',mine:'雷',rocket:'箭'}[type];
    const text=label?this.add.text(pos.x,pos.y+12,label,{fontSize:'12px',color:'#ffffff',fontFamily:'Microsoft YaHei',fontStyle:'bold',stroke:'#324961',strokeThickness:3}).setOrigin(.5):null;if(text)this.entityLayer.add(text);
    this.items.set(key(x,y),{x,y,type,sprite,text,available:this.tick+550});
  }
  collect(p){
    const k=key(p.x,p.y),item=this.items.get(k);if(!item||this.tick<item.available)return;
    switch(item.type){case'bomb':p.capacity=Math.min(8,p.capacity+1);break;case'fire':p.range=Math.min(8,p.range+1);break;case'speed':p.speed=Math.min(5,p.speed+1);break;case'shield':p.shield=1;break;case'glove':p.glove=true;break;case'life':p.lives=Math.min(5,p.lives+1);break;default:p.weapon=item.type;p.ammo=5;}
    p.score+=20;this.audit.pickups++;item.sprite.destroy();item.text?.destroy();this.items.delete(k);tone(960,.11,'sine',.04);
    if(p.human){const names={bomb:'炸弹数量 +1',fire:'火力 +1',speed:'速度提升',shield:'获得护盾',glove:'现在可以推炸弹',life:'生命 +1',flame:'火焰箭',ice:'冰箭',gas:'汽弹',grenade:'手榴弹',mine:'地雷',rocket:'火箭'};$('status-line').textContent='玩家 '+(p.id+1)+' · '+names[item.type]+(p.weapon?'，放弹键使用（'+p.ammo+'发）':'');}
  }
  explode(bomb,chain=false){
    if(bomb.removed)return;const cells=this.blastCells(bomb);bomb.removed=true;bomb.sprite.destroy();this.bombs=this.bombs.filter(b=>b!==bomb);
    const owner=this.players[bomb.owner];if(owner)owner.activeBombs=Math.max(0,owner.activeBombs-1);
    if(bomb.kind==='gas')return;
    this.audit.explosions++;if(chain)this.audit.chainReactions++;tone(95,.22,'sawtooth',.04);
    for(const c of cells){this.addFlame(c.x,c.y,bomb.owner,bomb.kind==='gas'?'gas':'fire',bomb.kind==='gas'?2000:480);if(this.tileAt(c.x,c.y)===2)this.destroyBox(c.x,c.y,bomb.owner);const other=this.bombAt(c.x,c.y);if(other)this.explode(other,true);}
  }
  useWeapon(p){
    const kind=p.weapon;
    if(['mine','gas','grenade'].includes(kind)){
      let x=p.x,y=p.y;if(kind==='grenade'){const [dx,dy]=DIRS[p.dir];for(let n=0;n<2;n++){if(this.tileAt(x+dx,y+dy)!==0)break;x+=dx;y+=dy;}}
      if(this.bombAt(x,y))return false;
      const pos=point(x,y),sprite=this.add.image(pos.x,pos.y-3,'atlas','bomb').setDisplaySize(25,33).setTint(kind==='gas'?0xa1e660:kind==='mine'?0xff86ae:0xffffff);this.entityLayer.add(sprite);
      this.bombs.push({id:++this.bombId,x,y,owner:p.id,range:1,due:kind==='grenade'?this.tick+900:Infinity,sprite,kind});p.activeBombs++;this.audit.bombsPlaced++;
    }else{
      const pos=point(p.x,p.y),sprite=this.add.image(pos.x,pos.y,'atlas',kind==='ice'?'power-shield':'power-fire').setDisplaySize(22,22);this.effectsLayer.add(sprite);
      this.projectiles.push({x:p.x,y:p.y,dir:p.dir,kind,owner:p.id,sprite,next:this.tick+50,steps:kind==='rocket'?COLS+ROWS:3});tone(kind==='ice'?850:280,.1,'triangle',.04);
    }
    p.ammo--;if(!p.ammo)p.weapon=null;return true;
  }
  updateProjectiles(){
    for(const shot of [...this.projectiles]){
      if(this.tick<shot.next)continue;shot.next+=shot.kind==='rocket'?50:4000/35;const [dx,dy]=DIRS[shot.dir];shot.x+=dx;shot.y+=dy;shot.steps--;
      const t=this.tileAt(shot.x,shot.y);if(t===1){shot.steps=0;}else{
        const pos=point(shot.x,shot.y);shot.sprite.setPosition(pos.x,pos.y);
        if(shot.kind!=='ice'||t===0)this.addFlame(shot.x,shot.y,shot.owner,shot.kind==='ice'?'ice':'fire',shot.kind==='ice'?450:350);
        if(t===2){if(shot.kind!=='ice')this.destroyBox(shot.x,shot.y,shot.owner);if(shot.kind!=='flame')shot.steps=0;}
        const bomb=this.bombAt(shot.x,shot.y);if(bomb&&shot.kind!=='ice'){this.explode(bomb,true);if(shot.kind!=='flame')shot.steps=0;}
        if(shot.kind==='rocket'&&(t===2||this.players.some(p=>p.alive&&p.id!==shot.owner&&p.x===shot.x&&p.y===shot.y))){for(const c of this.blastCells({x:shot.x,y:shot.y,range:2}))this.addFlame(c.x,c.y,shot.owner);shot.steps=0;}
      }
      if(shot.steps<=0){shot.sprite.destroy();this.projectiles=this.projectiles.filter(s=>s!==shot);}
    }
  }
  hit(p,owner){
    if(this.tick<p.invulnerable||!p.alive)return;
    if(p.shield){p.shield=0;p.invulnerable=this.tick+60000/35;tone(740,.12);return;}
    if(p.human){p.lives=Math.max(0,p.lives-1);if(p.lives>0){p.invulnerable=this.tick+60000/35;tone(180,.15);return;}}
    p.alive=false;p.move=null;p.sprite.setAlpha(.25).setTint(0x506579);p.ring.setVisible(false);this.audit.deaths++;
    if(owner!==p.id&&this.players[owner])this.players[owner].score+=100;tone(170,.3,'triangle',.05);
  }
  resolveRound(timeout=false){
    if(this.roundResolved)return;
    if(net?.active&&options.match==='versus'){
      const alive=this.players.filter(p=>p.alive);if(!timeout&&alive.length>1)return;
      let winners=alive;if(timeout){const best=Math.max(-1,...alive.map(p=>p.score));winners=alive.filter(p=>p.score===best);}
      this.winnerId=winners.length===1?winners[0].id:null;this.roundResolved=true;this.phase='result';this.finished=false;this.lastWon=this.winnerId===net.localId;
      this.showOnlineResult();this.updateHUD();return;
    }
    const humans=this.players.filter(p=>p.human&&p.alive),bots=this.players.filter(p=>!p.human&&p.alive);
    if(!timeout&&humans.length&&bots.length)return;
    let won=humans.length>0&&!bots.length;
    if(timeout)won=humans.length>0&&Math.max(...humans.map(p=>p.score))>Math.max(0,...bots.map(p=>p.score));
    this.roundResolved=true;this.phase='result';const total=options.difficulty==='easy'?15:options.difficulty==='hard'?25:20,finished=won&&this.round>=total;
    $('result-overlay').hidden=false;$('touch-controls').hidden=true;$('phase-label').textContent=won?'闯关成功':'本场结束';$('pause-button').disabled=true;
    $('result-icon').textContent=won?'🏆':'💫';$('result-kicker').textContent=won?'干得漂亮！':'再来一次';$('result-title').textContent=finished?'全部通关！':won?'闯关成功':'这次差一点';
    $('result-text').textContent=(timeout?'时间到，比较存活玩家分数。':'')+(won?(options.mode==='duo'?'合作默契！':'漂亮地拿下这一关！'):'先找退路，再放炸弹。')+' 本场得分 '+this.players.filter(p=>p.human).reduce((sum,p)=>sum+p.score,0)+'。';
    $('next-round').textContent=net?.active?'再来一局':finished?'再玩一轮':won?'下一关':'再试一次';$('next-round').disabled=false;this.lastWon=won;this.finished=finished;this.updateHUD();tone(won?790:240,.4,'triangle',.05);
  }
  showOnlineResult(){
    const winner=this.players.find(p=>p.id===this.winnerId),won=winner?.id===net?.localId;
    $('result-overlay').hidden=false;$('touch-controls').hidden=true;$('pause-button').disabled=true;$('phase-label').textContent='对局结束';
    $('result-icon').textContent=winner?'🏆':'🤝';$('result-kicker').textContent=won?'你赢了！':'本场结束';$('result-title').textContent=winner?(winner.name||CHAR_NAMES[winner.char])+' 获胜':'平局';
    $('result-text').textContent='本场得分 '+(this.players[net?.localId]?.score||0)+'。'+(net?.isHost?'可以再开一局。':'等待房主开始下一局。');
    $('next-round').textContent=net?.isHost?'再来一局':'等待房主';$('next-round').disabled=!net?.isHost;
  }
  networkState(){
    return {matchId:this.netRound,phase:this.phase,round:this.round,tick:this.tick,remaining:this.remaining,options:{...options},map:this.map,
      players:this.players.map(p=>({id:p.id,x:p.x,y:p.y,char:p.char,human:p.human,name:p.name,alive:p.alive,range:p.range,capacity:p.capacity,speed:p.speed,activeBombs:p.activeBombs,score:p.score,shield:p.shield,lives:p.lives,dir:p.dir,renderX:p.sprite.x,renderY:p.sprite.y,invulnerable:p.invulnerable,frozenUntil:p.frozenUntil})),
      bombs:this.bombs.map(({id,x,y,owner,kind})=>({id,x,y,owner,kind})),flames:this.flames.map(({x,y,owner,kind})=>({x,y,owner,kind})),items:[...this.items.values()].map(({x,y,type})=>({x,y,type})),projectiles:this.projectiles.map(({x,y,owner,kind})=>({x,y,owner,kind})),audit:{...this.audit},winnerId:this.winnerId,lastWon:this.lastWon,finished:this.finished};
  }
  applyNetworkState(state){
    const fresh=this.netRound!==state.matchId;
    Object.assign(options,state.options);this.tick=state.tick;this.remaining=state.remaining;this.round=state.round;this.winnerId=state.winnerId;this.lastWon=state.lastWon;this.finished=state.finished;this.audit={...state.audit};
    if(fresh){this.netRound=state.matchId;this.entityLayer.removeAll(true);this.effectsLayer.removeAll(true);this.remoteVisuals=new Map();this.bombs=[];this.flames=[];this.projectiles=[];this.items=new Map();
      this.players=state.players.map(data=>{const sprite=this.add.image(data.renderX,data.renderY,'atlas',CHAR_FRAMES[data.char]+'-down').setDisplaySize(37,44),ring=this.add.graphics().lineStyle(2,COLORS[data.char],.6).strokeEllipse(0,0,31,12);this.entityLayer.add([ring,sprite]);return {...data,sprite,ring};});
      $('menu').hidden=true;$('room-bar').hidden=false;$('p2-guide').hidden=true;$('p1-keys').textContent='↑ ↓ ← → / WASD';$('control-player').textContent='你的角色';$('pause-guide').textContent='房主暂停';$('game').focus();
    }
    const mapString=JSON.stringify(state.map);if(fresh||mapString!==this.netMapString){this.map=state.map.map(row=>[...row]);this.netMapString=mapString;this.drawMap();}
    for(const data of state.players){const p=this.players[data.id];if(!p)continue;Object.assign(p,data);p.targetX=data.renderX;p.targetY=data.renderY;p.sprite.setFrame(CHAR_FRAMES[p.char]+(p.dir===0?'-up':'-down')).setFlipX(p.dir===3).setAlpha(p.alive?(this.tick<p.invulnerable?.65:1):.25).setTint(!p.alive?0x506579:p.frozenUntil>this.tick?0x83d9ff:0xffffff);p.ring.setVisible(p.alive);}
    const visuals=[];
    for(const b of state.bombs)visuals.push({key:'bomb-'+b.id,x:b.x,y:b.y,frame:'bomb',size:30,tint:b.kind==='gas'?0xa1e660:b.kind==='mine'?0xff86ae:0xffffff});
    for(const f of state.flames)visuals.push({key:'flame-'+key(f.x,f.y)+'-'+f.kind,x:f.x,y:f.y,frame:f.kind==='ice'?'power-shield':'power-fire',size:40,tint:f.kind==='ice'?0x91e5ff:0xffaa38});
    for(const item of state.items)visuals.push({key:'item-'+key(item.x,item.y),x:item.x,y:item.y,frame:{bomb:'power-bomb',fire:'power-fire',speed:'power-speed',shield:'power-shield',glove:'power-speed',life:'power-shield',flame:'power-fire',ice:'power-shield',gas:'power-speed',grenade:'power-bomb',mine:'power-bomb',rocket:'power-fire'}[item.type],size:28});
    state.projectiles.forEach((s,i)=>visuals.push({key:'shot-'+i,x:s.x,y:s.y,frame:s.kind==='ice'?'power-shield':'power-fire',size:22}));
    const live=new Set();for(const v of visuals){live.add(v.key);const pos=point(v.x,v.y);let sprite=this.remoteVisuals.get(v.key);if(!sprite){sprite=this.add.image(pos.x,pos.y,'atlas',v.frame);this.effectsLayer.add(sprite);this.remoteVisuals.set(v.key,sprite);}sprite.setPosition(pos.x,pos.y).setDisplaySize(v.size,v.size).setTint(v.tint||0xffffff);}
    for(const [id,sprite] of this.remoteVisuals)if(!live.has(id)){sprite.destroy();this.remoteVisuals.delete(id);}
    this.bombs=state.bombs;this.flames=state.flames;this.items=new Map(state.items.map(item=>[key(item.x,item.y),item]));
    this.phase=state.phase;$('round-label').textContent='ROUND '+String(this.round).padStart(2,'0');$('mode-label').textContent=options.match==='coop'?'联机合作':'联机对战';$('pause-overlay').hidden=this.phase!=='paused';$('resume').disabled=true;$('resume').textContent='等待房主继续';$('pause-button').disabled=true;$('result-overlay').hidden=this.phase!=='result';$('phase-label').textContent=this.phase==='paused'?'房主暂停中':this.phase==='result'?'对局结束':'正在联机';$('touch-controls').hidden=this.phase!=='playing'||!matchMedia('(pointer:coarse)').matches;
    if(this.phase==='result'){if(options.match==='versus')this.showOnlineResult();else{$('result-title').textContent=this.lastWon?'合作过关！':'本场结束';$('result-text').textContent='等待房主开始下一局。';$('next-round').textContent='等待房主';$('next-round').disabled=true;}}
    this.updateHUD();
  }
  renderNetworkPlayers(delta){for(const p of this.players){const f=Math.min(1,delta/65);p.sprite.x=Phaser.Math.Linear(p.sprite.x,p.targetX??p.renderX,f);p.sprite.y=Phaser.Math.Linear(p.sprite.y,p.targetY??p.renderY,f);p.ring.setPosition(p.sprite.x,p.sprite.y+19);}}
  update(time,delta,networkTick=false){
    if(net?.active&&!net.isHost){net.pollInput();if(net.pendingState){this.applyNetworkState(net.pendingState);net.pendingState=null;}this.renderNetworkPlayers(delta);return;}
    if(net?.active&&net.isHost&&net.matchStarted&&!networkTick)return;
    if(this.phase!=='playing')return;
    const dt=Math.min(delta,50);this.tick+=dt;this.remaining=Math.max(0,this.remaining-dt);
    for(const p of this.players){
      if(!p.alive)continue;
      if(p.human)this.humanInput(p);else this.botInput(p);
      if(p.move){
        const m=p.move,f=Math.min(1,(this.tick-m.start)/m.duration),from=point(m.sx,m.sy),to=point(m.x,m.y);p.sprite.setPosition(Phaser.Math.Linear(from.x,to.x,f),Phaser.Math.Linear(from.y,to.y,f)-7-Math.sin(f*Math.PI)*3);p.ring.setPosition(p.sprite.x,p.sprite.y+19);
        if(f>=1){p.x=m.x;p.y=m.y;p.move=null;this.collect(p);}
      }else this.collect(p);
      p.sprite.setAlpha(this.tick<p.invulnerable?(Math.floor(this.tick/110)%2?.45:1):1);p.sprite.setTint(p.frozenUntil>this.tick?0x83d9ff:0xffffff);
    }
    for(const b of [...this.bombs]){if(b.due<=this.tick)this.explode(b);else if(!b.removed){const pulse=1+Math.sin(this.tick*.025)*.05;b.sprite.setDisplaySize(26*pulse,35*pulse);}}
    this.updateProjectiles();
    for(const f of [...this.flames]){if(this.tick>=f.until){f.halo.destroy();f.sprite.destroy();this.flames=this.flames.filter(v=>v!==f);}else f.sprite.setAlpha(.65+.3*Math.sin(this.tick*.05));}
    for(const p of this.players){
      if(!p.alive)continue;
      for(const trap of [...this.bombs]){
        if(trap.owner===p.id||!['mine','gas'].includes(trap.kind))continue;
        const center=point(trap.x,trap.y),distance=Math.hypot(p.sprite.x-center.x,p.sprite.y+7-center.y);
        if(distance<(trap.kind==='gas'?2:TILE/2)){if(trap.kind==='gas')p.slowUntil=this.tick+2600;this.explode(trap);}
      }
    }
    for(const p of this.players){
      if(!p.alive)continue;
      const actualX=Math.round((p.sprite.x-OX-TILE/2)/TILE),actualY=Math.round((p.sprite.y+7-OY-TILE/2)/TILE);
      for(const flame of this.flames)if(flame.x===actualX&&flame.y===actualY){if(flame.kind==='ice'){if(flame.owner!==p.id)p.frozenUntil=Math.max(p.frozenUntil,this.tick+1800);}else if(flame.kind==='gas')p.slowUntil=this.tick+2600;else this.hit(p,flame.owner);}
    }
    if(this.tick-this.lastHud>120){this.updateHUD();this.lastHud=this.tick;}
    this.resolveRound();if(this.phase==='playing'&&this.remaining<=0)this.resolveRound(true);
  }
}
const game=new Phaser.Game({type:Phaser.AUTO,width:832,height:616,parent:'game',backgroundColor:'#ffe8bd',scene:Arena,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,roundPixels:true},audio:{noAudio:true}});
function selectMode(mode){if(net?.active&&mode!=='online')net.leave();options.mode=mode;document.querySelectorAll('#mode-options button').forEach(b=>b.classList.toggle('selected',b.dataset.value===mode));$('online-controls').hidden=mode!=='online';$('start').hidden=mode==='online';$('menu-hint').textContent=mode==='online'?'创建房间后，把链接发给好友。':mode==='duo'?'玩家 1：WASD + 空格　玩家 2：方向键 + Enter':'方向键移动 · 空格放炸弹';}
document.querySelectorAll('#mode-options button').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.value)));
document.querySelectorAll('[data-character]').forEach(b=>b.addEventListener('click',()=>{options.character=Number(b.dataset.character);document.querySelectorAll('[data-character]').forEach(c=>c.classList.toggle('selected',c===b));tone(660,.06);}));
$('difficulty').addEventListener('change',e=>options.difficulty=e.target.value);$('theme').addEventListener('change',e=>{options.theme=e.target.value;if(arena?.phase==='menu')arena.drawMap();});
$('start').disabled=true;$('start').addEventListener('click',()=>arena?.startRound());
$('pause-button').addEventListener('click',()=>arena?.togglePause());$('resume').addEventListener('click',()=>arena?.setPaused(false));
function showMenu(){if(!arena)return;if(net?.active){net.leave();}arena.phase='menu';arena.touch.clear();$('menu').hidden=false;$('pause-overlay').hidden=true;$('result-overlay').hidden=true;$('touch-controls').hidden=true;$('room-bar').hidden=true;$('pause-button').disabled=true;$('phase-label').textContent='准备出发';$('resume').disabled=false;$('resume').textContent='继续游戏';$('next-round').disabled=false;}
['back-menu','pause-menu','result-menu'].forEach(id=>$(id).addEventListener('click',showMenu));
$('next-round').addEventListener('click',()=>{if(net?.active){if(net.isHost)net.startMatch();return;}if(arena.finished){arena.startRound(true);}else if(arena.lastWon){arena.round++;arena.startRound(false);}else arena.startRound(false);});
$('sound').addEventListener('click',()=>{soundEnabled=!soundEnabled;$('sound').setAttribute('aria-pressed',String(soundEnabled));$('sound').setAttribute('aria-label',soundEnabled?'关闭声音':'开启声音');$('sound').querySelector('span').textContent=soundEnabled?'声音开':'声音关';tone(520,.15);});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.cabinet').requestFullscreen();}catch(_){$('status-line').textContent='当前窗口暂不支持全屏，可放大浏览器窗口。';}});
document.querySelectorAll('[data-touch]').forEach(b=>{const action=b.dataset.touch;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);if(action==='bomb'){if(net?.active)net.sendInput(-1,true);else if(arena?.phase==='playing')arena.placeBomb(arena.players[0]);}else arena?.touch.add(action);});for(const evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>arena?.touch.delete(action));});
window.addEventListener('blur',()=>{if(arena?.phase==='playing'&&!net?.active)arena.setPaused(true);net?.releaseInput();});
window.bubbleGame={snapshot:()=>({phase:arena?.phase,round:arena?.round,tick:arena?.tick,remaining:arena?.remaining,options:{...options},players:arena?.players.map(({id,x,y,alive,char,range,capacity,speed,activeBombs,score,shield,lives,move})=>({id,x,y,alive,char,range,capacity,speed,activeBombs,score,shield,lives,moving:!!move})),bombs:arena?.bombs.map(({id,x,y,owner,due,range,kind})=>({id,x,y,owner,due,range,kind})),items:arena?[...arena.items].map(([at,v])=>({at,type:v.type})):[],map:arena?.map.map(r=>[...r]),audit:arena?{...arena.audit}:null})};
