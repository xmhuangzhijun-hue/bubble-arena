'use strict';
// Native Pointer Events keep the movement finger independent of the bomb finger.
(() => {
  const stick=$('move-stick'),thumb=$('stick-thumb'),bomb=$('touch-bomb');
  let movementPointer=null,bombPointer=null,direction=null;
  const actions=['up','right','down','left'];
  const playable=()=>arena?.phase==='playing'&&$('exit-overlay').hidden;
  function clearDirection(){for(const action of actions)arena?.touch.delete(action);direction=null;net?.releaseInput();}
  function release(){clearDirection();movementPointer=null;bombPointer=null;thumb.style.setProperty('--stick-x','0px');thumb.style.setProperty('--stick-y','0px');stick.classList.remove('is-held');bomb.classList.remove('is-held');}
  function move(event){
    if(event.pointerId!==movementPointer||!playable())return;
    const rect=stick.getBoundingClientRect(),dx=event.clientX-rect.left-rect.width/2,dy=event.clientY-rect.top-rect.height/2;
    const distance=Math.hypot(dx,dy),scale=distance>30?30/distance:1;
    thumb.style.setProperty('--stick-x',dx*scale+'px');thumb.style.setProperty('--stick-y',dy*scale+'px');
    const next=distance<12?null:Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
    if(next===direction)return;
    clearDirection();direction=next;
    if(next){arena.touch.add(next);if(net?.active){net.lastDirection=actions.indexOf(next);net.sendInput(actions.indexOf(next),false);}else arena.tryMove(arena.players[0],actions.indexOf(next));}
  }
  stick.addEventListener('pointerdown',event=>{if(!playable()||movementPointer!==null)return;event.preventDefault();movementPointer=event.pointerId;stick.setPointerCapture(event.pointerId);stick.classList.add('is-held');move(event);});
  stick.addEventListener('pointermove',event=>{if(event.pointerId===movementPointer){event.preventDefault();move(event);}});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(name,event=>{if(event.pointerId!==movementPointer)return;clearDirection();movementPointer=null;thumb.style.setProperty('--stick-x','0px');thumb.style.setProperty('--stick-y','0px');stick.classList.remove('is-held');});
  bomb.addEventListener('pointerdown',event=>{if(!playable()||bombPointer!==null)return;event.preventDefault();bombPointer=event.pointerId;bomb.setPointerCapture(event.pointerId);bomb.classList.add('is-held');if(net?.active)net.sendInput(net.heldDirection(),true,true);else arena.requestTouchBomb(arena.players[0]);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])bomb.addEventListener(name,event=>{if(event.pointerId===bombPointer){bombPointer=null;bomb.classList.remove('is-held');}});
  window.bubbleControls={release};
  window.addEventListener('blur',release);
  window.addEventListener('resize',()=>{release();syncControls();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  const pointerMode=matchMedia('(pointer:coarse)');pointerMode.addEventListener?.('change',()=>{release();syncControls();selectMode(options.mode);});
  syncControls();selectMode(options.mode);
})();
