import { escapeXml } from '../../../shared/xml'
import { findEl, type Deck } from '../model'
import { buildSteps } from '../show/anim'

/** A single .html file that plays the deck: arrows, swipe, full screen, transitions and animations. It needs nothing else to run. */
export async function writeHtml(deck: Deck): Promise<string> {
  const { withRenderedSlides } = await import('../lib/offscreen')
  const { pageCss } = await import('../lib/raster')
  const idx = deck.slides.map((_, i) => i).filter((i) => !deck.slides[i].hidden)
  const slides = await withRenderedSlides(deck, idx, (els) => els.map((e) => e.outerHTML))
  const css = await pageCss(slides.join(''))
  const data = idx.map((i) => {
    const s = deck.slides[i]
    return {
      trans: s.trans && s.trans.kind !== 'none' ? s.trans : null, auto: s.auto ?? 0,
      steps: buildSteps(s).map((st) => st.map((t) => { const e = findEl(s.els, t.anim.target); return { id: t.anim.target, para: t.para ?? null, effect: t.anim.effect, kind: t.anim.kind, dir: t.anim.dir ?? 'left', dur: t.anim.dur, at: t.at, x: e?.x ?? 0, y: e?.y ?? 0, w: e?.w ?? 0, h: e?.h ?? 0 } })),
      links: [] as string[],
    }
  })
  const json = JSON.stringify({ w: deck.w, h: deck.h, loop: deck.show.loop, timings: deck.show.useTimings, slides: data }).replace(/</g, '\\u003c')
  const bg = '#000'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(deck.title)}</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}
html,body{margin:0;height:100%;background:${bg};overflow:hidden;font-family:system-ui,sans-serif}
.sl{position:absolute;left:50%;top:50%;visibility:hidden}.sl.on{visibility:visible}
.sl .slide{overflow:hidden}
#bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:4px;background:rgba(25,18,12,.88);color:#fff;padding:4px 8px;border-radius:14px;opacity:0;transition:opacity .25s;z-index:9}#bar.on{opacity:1}
#bar button{background:none;border:0;color:#fff;font-size:16px;min-width:36px;min-height:36px;cursor:pointer;border-radius:8px}#bar button:hover{background:rgba(255,255,255,.15)}#bar span{align-self:center;padding:0 8px;font-variant-numeric:tabular-nums}
</style></head><body>
${slides.map((h, i) => `<div class="sl" data-i="${i}">${h}</div>`).join('\n')}
<div id="bar"><button id="prev" aria-label="Previous">◀</button><span id="pos"></span><button id="next" aria-label="Next">▶</button><button id="fs" aria-label="Full screen">⛶</button></div>
<script>
var D=${json};
(function(){
var secs=[].slice.call(document.querySelectorAll('.sl')),idx=0,step=0,busy=false,timer=0,hide=0;
function fit(){var k=Math.min(innerWidth/D.w,innerHeight/D.h);secs.forEach(function(s){s.style.width=D.w+'px';s.style.height=D.h+'px';s.style.transform='translate(-50%,-50%) scale('+k+')'})}
function off(dir,a){return dir==='left'?[-(a.x+a.w+10),0]:dir==='right'?[D.w-a.x+10,0]:dir==='up'?[0,-(a.y+a.h+10)]:[0,D.h-a.y+10]}
function frames(a){var inn=a.kind==='in';function pair(f,t){return inn?[Object.assign({visibility:'visible'},f),Object.assign({visibility:'visible'},t)]:[Object.assign({visibility:'visible'},t),Object.assign({visibility:'hidden'},f)]}
switch(a.effect){case'appear':return pair({opacity:1},{opacity:1});case'fade':return pair({opacity:0},{opacity:1});
case'fly':var o=off(a.dir,a);return pair({translate:o[0]+'px '+o[1]+'px'},{translate:'0px 0px'});
case'float':return pair({translate:'0 40px',opacity:0},{translate:'0 0',opacity:1});case'zoom':return pair({scale:'0.1',opacity:0},{scale:'1',opacity:1});
case'wipe':return pair({clipPath:a.dir==='left'?'inset(0 100% 0 0)':a.dir==='right'?'inset(0 0 0 100%)':a.dir==='up'?'inset(0 0 100% 0)':'inset(100% 0 0 0)'},{clipPath:'inset(0 0 0 0)'});
case'split':return pair({clipPath:'inset(0 50% 0 50%)'},{clipPath:'inset(0 0 0 0)'});case'blinds':return pair({clipPath:'inset(0 0 100% 0)'},{clipPath:'inset(0 0 0 0)'});
case'grow':return[{scale:'1'},{scale:'1.4'}];case'spin':return[{rotate:'0deg'},{rotate:'360deg'}];case'pulse':case'color':return[{scale:'1'},{scale:'1.12',offset:.5},{scale:'1'}];
case'bounce':return[{translate:'0 0'},{translate:'0 -24px',offset:.3},{translate:'0 0'}];case'teeter':return[{rotate:'0deg'},{rotate:'-6deg',offset:.25},{rotate:'6deg',offset:.75},{rotate:'0deg'}];}return pair({opacity:0},{opacity:1})}
function nodes(sec,t){var b=sec.querySelector('[data-el="'+t.id+'"]');if(!b)return[];if(t.para===null)return[b];var p=b.querySelector('p[data-pi="'+t.para+'"]');return p?[p]:[]}
function reset(sec,i,upTo){[].slice.call(sec.querySelectorAll('[data-el],p[data-pi]')).forEach(function(n){n.getAnimations().forEach(function(a){a.cancel()});n.style.visibility=''});
D.slides[i].steps.forEach(function(st){st.forEach(function(t){if(t.kind==='in')nodes(sec,t).forEach(function(n){n.style.visibility='hidden'})})});for(var k=0;k<upTo;k++)play(sec,i,k,true)}
function play(sec,i,k,instant){var all=[];D.slides[i].steps[k].forEach(function(t){nodes(sec,t).forEach(function(n){if(t.kind==='in')n.style.visibility='visible';var an=n.animate(frames(t),{duration:instant?0:Math.max(1,t.dur*1000),delay:instant?0:t.at*1000,fill:'both',easing:'cubic-bezier(.25,.1,.25,1)'});if(instant)an.finish();else an.finished.then(function(){if(t.kind==='out')n.style.visibility='hidden'},function(){});all.push(an.finished.catch(function(){}))})});return Promise.all(all)}
function ui(){document.getElementById('pos').textContent=(idx+1)+' / '+secs.length}
function show(i,fwd){if(busy||i<0||i>=secs.length)return;var old=secs[idx],nu=secs[i],t=D.slides[i].trans;busy=true;var prev=idx;idx=i;step=0;reset(nu,i,fwd===false?D.slides[i].steps.length:0);if(fwd===false)step=D.slides[i].steps.length;
nu.classList.add('on');nu.style.zIndex=2;old.style.zIndex=1;var k=Math.min(innerWidth/D.w,innerHeight/D.h),base='translate(-50%,-50%) scale('+k+')';var anims=[];
if(prev!==i&&t){var d=(t.dur||.7)*1000,o={duration:d,easing:'ease',fill:'both'};if(t.kind==='push'||t.kind==='cover'){var dx=(t.dir==='right'?-1:1)*D.w*k;anims.push(nu.animate([{transform:'translate('+dx+'px,0) '+base},{transform:base}],o));if(t.kind==='push')anims.push(old.animate([{transform:base},{transform:'translate('+(-dx)+'px,0) '+base}],o))}
else if(t.kind==='wipe'||t.kind==='split'||t.kind==='blinds')anims.push(nu.animate([{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0 0 0)'}],o));else if(t.kind==='zoom')anims.push(nu.animate([{opacity:0,scale:'.4'},{opacity:1,scale:'1'}],o));else anims.push(nu.animate([{opacity:0},{opacity:1}],o))}
Promise.all(anims.map(function(a){return a.finished.catch(function(){})})).then(function(){if(prev!==i)old.classList.remove('on');old.style.zIndex=0;anims.forEach(function(a){a.cancel()});busy=false;ui();
if(fwd!==false&&D.slides[i].steps.length&&D.slides[i].steps[0]&&firstAuto(i)){busy=true;step=1;play(nu,i,0).then(function(){busy=false})}timing()})}
function firstAuto(i){var s=D.slides[i].steps[0];return false&&s}
function timing(){clearTimeout(timer);var a=D.slides[idx].auto;if(D.timings&&a)timer=setTimeout(next,a*1000)}
function next(){if(busy)return;var st=D.slides[idx].steps;if(step<st.length){busy=true;var k=step++;play(secs[idx],idx,k).then(function(){busy=false});return}if(idx<secs.length-1)show(idx+1,true);else if(D.loop)show(0,true)}
function prev(){if(busy)return;if(step>0){step--;reset(secs[idx],idx,step);return}if(idx>0)show(idx-1,false)}
addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Enter'){e.preventDefault();next()}else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){e.preventDefault();prev()}else if(k==='Home')show(0,false);else if(k==='End')show(secs.length-1,true);else if(k==='f'||k==='F')document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()});
var sx=0,sy=0;addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){dx<0?next():prev()}});
addEventListener('click',function(e){if(e.target.closest('#bar,a'))return;e.clientX<innerWidth/4?prev():next()});
document.getElementById('prev').onclick=function(e){e.stopPropagation();prev()};document.getElementById('next').onclick=function(e){e.stopPropagation();next()};document.getElementById('fs').onclick=function(e){e.stopPropagation();document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()};
var bar=document.getElementById('bar');addEventListener('mousemove',function(){bar.classList.add('on');clearTimeout(hide);hide=setTimeout(function(){bar.classList.remove('on')},2500)});
addEventListener('resize',fit);fit();secs[0].classList.add('on');reset(secs[0],0,0);ui();timing();
})();
</script></body></html>
`
}
