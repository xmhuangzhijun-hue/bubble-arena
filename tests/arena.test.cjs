const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

// Execute the actual shipped Arena methods with deterministic rendering/DOM stubs.
// This verifies game state behavior; it does not replace browser keyboard acceptance.
function graphic(x=0,y=0) {
  const g={x,y,destroyed:false,destroy(){this.destroyed=true;},setPosition(x,y){this.x=x;this.y=y;return this;}};
  for(const m of ['setDisplaySize','setDepth','setTint','setAlpha','setFrame','setFlipX','setVisible','lineStyle','strokeEllipse','fillStyle','fillRoundedRect','fillRect','strokeRect','setOrigin'])g[m]=()=>g;
  return g;
}
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',innerHTML:'',disabled:false,addEventListener(){},focus(){},setAttribute(){},querySelector(){return element(id+'.child');},classList:{toggle(){}}});return elements.get(id);}
const context={console,Math,Date,Map,Set,Infinity,document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>element('query'),fullscreenElement:null},window:{addEventListener(){}},matchMedia:()=>({matches:false}),Phaser:{Scene:class{},Game:class{},AUTO:0,Scale:{FIT:0,CENTER_BOTH:0},Math:{Linear:(a,b,f)=>a+(b-a)*f},Input:{Keyboard:{JustDown:()=>false}}}};
vm.createContext(context);
const gamePath=path.resolve(__dirname,'../dist/game.js');
vm.runInContext(fs.readFileSync(gamePath,'utf8')+'\nglobalThis.TestArena=Arena;globalThis.TestOptions=options;',context,{filename:gamePath});
function player(id,human,x,y,lives=1){return {id,human,x,y,lives,alive:true,score:0,char:id,capacity:2,range:2,speed:0,activeBombs:0,shield:0,glove:false,weapon:null,ammo:0,frozenUntil:0,slowUntil:0,invulnerable:0,lastBomb:-5000,dir:1,move:null,sprite:graphic(86+x*44+22,22+y*44+22-7),ring:graphic()};}
function arena(players){
  const a=new context.TestArena();a.phase='playing';a.remaining=180000;a.lastHud=0;a.bombId=0;a.roundResolved=false;
  a.map=Array.from({length:13},(_,y)=>Array.from({length:15},(_,x)=>x===0||y===0||x===14||y===12?1:0));
  a.players=players||[player(0,true,1,1),player(1,false,13,11)];
  a.add={image:(x,y)=>graphic(x,y),graphics:()=>graphic(),text:(x,y)=>graphic(x,y)};a.entityLayer={add(){}};a.effectsLayer={add(){}};a.tiles=new Map();
  a.humanInput=()=>{};a.botInput=()=>{};a.seed=378;return a;
}
const results=[];
function test(name,run){run();results.push({name,status:'PASS'});}

test('One total life dies on its first unshielded hit',()=>{const a=arena(),p=a.players[0];a.hit(p,1);assert.equal(p.lives,0);assert.equal(p.alive,false);assert.equal(a.audit.deaths,1);});
test('Two total lives become one and remain alive',()=>{const a=arena(),p=a.players[0];p.lives=2;a.hit(p,1);assert.equal(p.lives,1);assert.equal(p.alive,true);assert(p.invulnerable>a.tick);});
test('Shield absorbs a hit without losing a life',()=>{const a=arena(),p=a.players[0];p.shield=1;a.hit(p,1);assert.equal(p.shield,0);assert.equal(p.lives,1);assert.equal(p.alive,true);assert(p.invulnerable>a.tick);});
test('Same frame kills both humans and last AI before resolving a loss',()=>{const a=arena([player(0,true,1,1),player(1,true,2,1),player(2,false,3,1)]);context.TestOptions.mode='duo';for(const p of a.players)a.addFlame(p.x,p.y,2);a.update(0,16);assert.equal(a.players.some(p=>p.alive),false);assert.equal(a.lastWon,false);assert.equal(a.phase,'result');assert.equal(a.audit.deaths,3);context.TestOptions.mode='solo';});
test('Chain explosion removes two bombs and returns their capacity',()=>{const a=arena(),p=a.players[0];p.x=3;p.y=3;assert.equal(a.placeBomb(p),true);a.tick=200;p.x=5;assert.equal(a.placeBomb(p),true);assert.equal(p.activeBombs,2);a.explode(a.bombs[0]);assert.equal(a.bombs.length,0);assert.equal(p.activeBombs,0);assert.equal(a.audit.explosions,2);assert.equal(a.audit.chainReactions,1);});
test('Moving rejects weapon placement without consuming ammo',()=>{const a=arena(),p=a.players[0];p.weapon='gas';p.ammo=2;p.move={x:2,y:1};assert.equal(a.placeBomb(p),false);assert.equal(p.ammo,2);assert.equal(a.bombs.length,0);assert.equal(p.lastBomb,-5000);});
test('Invalid placement onto a bomb does not consume weapon ammo',()=>{const a=arena(),p=a.players[0];assert.equal(a.placeBomb(p),true);a.tick=300;p.weapon='gas';p.ammo=2;assert.equal(a.placeBomb(p),false);assert.equal(p.ammo,2);assert.equal(a.bombs.length,1);});
test('Gas and mine are persistent traps without timed detonation',()=>{for(const kind of ['gas','mine']){const a=arena(),p=a.players[0];p.weapon=kind;p.ammo=2;assert.equal(a.placeBomb(p),true);assert.equal(a.bombs[0].due,Infinity);a.tick=12000;a.update(0,16);assert.equal(a.bombs.length,1);assert.equal(a.audit.explosions,0);assert.equal(p.ammo,1);}});
test('Gas contact slows only the opponent and creates no flame',()=>{const a=arena(),p=a.players[0];p.weapon='gas';p.ammo=2;a.placeBomb(p);const enemy=a.players[1];enemy.x=p.x;enemy.y=p.y;enemy.sprite.setPosition(p.sprite.x,p.sprite.y);a.update(0,16);assert.equal(a.bombs.length,0);assert(enemy.slowUntil>a.tick);assert.equal(p.slowUntil,0);assert.equal(a.flames.length,0);assert.equal(enemy.alive,true);});
test('Mine contact explodes and damages the opponent',()=>{const a=arena(),p=a.players[0];p.weapon='mine';p.ammo=2;a.placeBomb(p);const enemy=a.players[1];enemy.x=p.x;enemy.y=p.y;enemy.sprite.setPosition(p.sprite.x,p.sprite.y);p.invulnerable=1000;a.update(0,16);assert.equal(a.bombs.length,0);assert.equal(enemy.alive,false);assert.equal(a.lastWon,true);});
test('Pause freezes game time, movement, traps and bomb countdowns',()=>{const a=arena(),p=a.players[0];a.placeBomb(p);a.tryMove(p,1);a.setPaused(true);const before={tick:a.tick,time:a.remaining,x:p.sprite.x,due:a.bombs[0].due};a.update(0,50);assert.equal(a.tick,before.tick);assert.equal(a.remaining,before.time);assert.equal(p.sprite.x,before.x);assert.equal(a.bombs[0].due,before.due);});
test('Cooperation wins while one human remains and all AI are dead',()=>{const a=arena([player(0,true,1,1),player(1,true,2,1),player(2,false,13,11)]);a.players[1].alive=false;a.players[2].alive=false;a.resolveRound();assert.equal(a.lastWon,true);});

const report={checkedSource:gamePath,checks:results.length,passed:results.length,scope:'Actual Arena methods in Node vm, Phaser and DOM stubbed; browser input/rendering not verified here.',results};
console.log(JSON.stringify({checks:results.length,passed:results.length,scope:report.scope}));
