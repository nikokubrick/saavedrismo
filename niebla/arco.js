/* Capas Saavedristas: utilidades compartidas por Arco, Polilla, Engranaje y Congelador */
(function(){
  if(window.SVH)return;
  window.SVCapas=window.SVCapas||{};
  const NOTES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const SOLF=['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];
  let toastT=0;
  window.SVH={
    NOTES, SOLF,
    SCALE:{minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11]},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    tok:k=>getComputedStyle(document.documentElement).getPropertyValue('--'+k).trim(),
    mtof:m=>440*Math.pow(2,(m-69)/12),
    noteName:m=>{const r=Math.round(m),pc=((r%12)+12)%12; return NOTES[pc]+(Math.floor(r/12)-1)+' · '+SOLF[pc]},
    toast(t){let el=document.getElementById('toast'); if(!el){el=document.createElement('div'); el.id='toast'; el.className='toast'; document.body.appendChild(el)} el.textContent=t; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,2200)},
    css(id,txt){if(document.getElementById(id))return; const s=document.createElement('style'); s.id=id; s.textContent=txt; document.head.appendChild(s)},
    store(key,def){let v=Object.assign({},def); try{const s=JSON.parse(localStorage.getItem(key)||'null'); if(s&&typeof s==='object')v=Object.assign({},def,s)}catch(e){} return {v,save(){try{localStorage.setItem(key,JSON.stringify(v))}catch(e){}}}},
    // perillas: list = [[id,label,min,max,step,fmt?]]
    knobs(box,list,st,save,onChange){
      box.innerHTML=list.map(([id,l,mi,ma,stp])=>`<label class="k"><span>${l}</span><input type="range" data-k="${id}" min="${mi}" max="${ma}" step="${stp}" aria-label="${l}"><output data-o="${id}"></output></label>`).join('');
      list.forEach(([id,,,,,fmt])=>{const r=box.querySelector(`[data-k="${id}"]`),o=box.querySelector(`[data-o="${id}"]`),f=fmt||(v=>v);
        r.value=st[id]; o.textContent=f(st[id]); r.addEventListener('input',()=>{st[id]=+r.value; o.textContent=f(st[id]); save(); onChange&&onChange(id)})});
    },
    // botonera segmentada: el = contenedor con <button data-v>
    seg(el,key,st,save,cb){const bs=el.querySelectorAll('button'); const u=()=>bs.forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===String(st[key])));
      bs.forEach(b=>b.onclick=()=>{st[key]=b.dataset.v; save(); u(); cb&&cb()}); u(); return u},
    shaper(ctx,k){const c=new Float32Array(2048); for(let i=0;i<2048;i++){const x=i/1023.5-1; c[i]=Math.tanh(x*(k||3))} const w=ctx.createWaveShaper(); w.curve=c; w.oversample='4x'; return w},
    noise(ctx,sec){const len=Math.floor(ctx.sampleRate*(sec||2)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0); for(let i=0;i<len;i++)d[i]=Math.random()*2-1; return b},
    // eco con filtro en la repetición
    echo(ctx){const i=ctx.createGain(),d=ctx.createDelay(3),fb=ctx.createGain(),lp=ctx.createBiquadFilter(),o=ctx.createGain();
      lp.type='lowpass'; lp.frequency.value=2600; i.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(o);
      return {in:i,out:o,set(time,feedback,level){const t=ctx.currentTime; d.delayTime.setTargetAtTime(time,t,0.2); fb.gain.setTargetAtTime(feedback,t,0.1); o.gain.setTargetAtTime(level,t,0.1)}}},
    pixelSprite(cv,rows,map){const w=rows[0].length,h=rows.length; cv.width=w; cv.height=h;
      const draw=()=>{const g=cv.getContext('2d'); g.clearRect(0,0,w,h); rows.forEach((r,y)=>[...r].forEach((ch,x)=>{if(map[ch]){g.fillStyle=window.SVH.tok(map[ch]); g.fillRect(x,y,1,1)}}))};
      draw(); try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw)}catch(e){}},
    // tempo del eco: corchea con puntillo
    dotted8:bpm=>Math.max(0.12,Math.min(1.8,60/bpm*0.75))
  };
})();

/* ARCO: violín y voces que se tocan arrastrando el dedo, con looper */
(function(){
  const H=window.SVH;
  H.css('css-arco',`
.arco{display:grid; gap:14px}
.arco .board{padding:8px; display:grid; gap:6px}
.arco canvas.pad{width:100%; aspect-ratio:1/1.05; max-height:62vh; display:block; touch-action:none; cursor:crosshair; image-rendering:pixelated; image-rendering:crisp-edges; background:var(--raised); -webkit-user-select:none; user-select:none}
.arco .lanes{display:grid; font:500 11px var(--f-pixel); color:var(--muted); text-align:center}
.arco .lanes .root{color:var(--accent)}
.arco .axis{display:flex; justify-content:space-between; gap:8px; font-size:12.5px; color:var(--muted)}
.arco .now{display:flex; justify-content:space-between; align-items:baseline; gap:10px}
.arco .now b{font:700 24px var(--f-mono)}
.arco .now span{font-size:13.5px; color:var(--muted)}
.arco .loop{padding:12px; display:grid; gap:10px}
.arco .loopbar{height:10px; background:var(--raised); position:relative; overflow:hidden}
.arco .loopbar i{position:absolute; inset:0 auto 0 0; width:0; background:var(--accent)}
.arco .loopbar.rec i{background:var(--sharp)}
.arco .layers{display:flex; gap:6px; flex-wrap:wrap; font-size:13.5px; color:var(--muted)}
.arco .layers b{font-weight:500; background:var(--raised); padding:4px 8px; color:var(--ink)}
@media (max-width:380px){.arco .lanes{font-size:9px}}`);

  function mount(root,host){
    const st0=H.store('arco-saavedrista',{timbre:'violin',oct:'0',glide:'scale',echo:40,space:65,fuzz:0,vib:55,vol:75});
    const st=st0.v, save=()=>st0.save();
    root.classList.add('arco');
    root.innerHTML=`
      <section class="board px">
        <div class="now"><b data-r="note">—</b><span data-r="hint">Arrastrá el dedo por el panel</span></div>
        <canvas class="pad" width="120" height="126" aria-label="Panel para tocar: hacia los lados cambia la nota, hacia arriba más intensidad"></canvas>
        <div class="lanes" data-r="lanes"></div>
        <div class="axis"><span>◀ grave</span><span>arriba: más fuerte</span><span>agudo ▶</span></div>
      </section>
      <div class="seg term px" data-r="glide"><button data-v="scale">Notas de la escala</button><button data-v="free">Deslizar libre</button></div>
      <section class="loop px">
        <div class="loopbar" data-r="bar"><i data-r="fill"></i></div>
        <div class="row"><button class="btn" data-r="rec">● GRABAR FRASE</button><button class="btn ghost sm" data-r="undo">DESHACER</button><button class="btn ghost sm" data-r="clear">BORRAR</button></div>
        <div class="layers" data-r="layers"></div>
      </section>
      <div class="seg term px" data-r="timbre"><button data-v="violin">Violín</button><button data-v="viola">Viola</button><button data-v="voz">Voz</button><button data-v="sierra">Sierra</button></div>
      <div class="seg term px" data-r="oct"><button data-v="-1">Octava −1</button><button data-v="0">Normal</button><button data-v="1">Octava +1</button></div>
      <div class="knobs px" data-r="knobs"></div>`;
    const R=n=>root.querySelector(`[data-r="${n}"]`);
    let ctx=null, B=null, noise=null, lanes=[];

    function buildLanes(){
      const sc=H.SCALE[host.mode()]; let base=60+host.key(); if(base>66)base-=12; base+=12*(+st.oct);
      lanes=[]; for(let i=0;i<15;i++)lanes.push(base+sc[i%7]+12*Math.floor(i/7));
      R('lanes').style.gridTemplateColumns=`repeat(${lanes.length},minmax(0,1fr))`;
      R('lanes').innerHTML=lanes.map((m,i)=>`<span class="${i%7===0?'root':''}">${H.NOTES[m%12].replace('#','♯')}</span>`).join('');
    }
    H.seg(R('glide'),'glide',st,save); H.seg(R('timbre'),'timbre',st,save); H.seg(R('oct'),'oct',st,save,buildLanes);
    H.knobs(R('knobs'),[['echo','Eco',0,100,1],['space','Espacio',0,100,1],['fuzz','Fuzz',0,100,1],['vib','Vibrato',0,100,1],['vol','Volumen',0,100,1]],st,save,()=>applyFx());

    async function ready(){
      ctx=await host.ensure(); if(B)return ctx;
      B={}; B.bus=ctx.createGain(); B.fzDry=ctx.createGain(); B.fzPre=ctx.createGain(); B.sh=H.shaper(ctx,3); B.fzLP=ctx.createBiquadFilter(); B.fzLP.type='lowpass'; B.fzLP.frequency.value=4000; B.fzWet=ctx.createGain(); B.out=ctx.createGain();
      B.bus.connect(B.fzDry); B.fzDry.connect(B.out); B.bus.connect(B.fzPre); B.fzPre.connect(B.sh); B.sh.connect(B.fzLP); B.fzLP.connect(B.fzWet); B.fzWet.connect(B.out);
      B.vol=ctx.createGain(); B.out.connect(B.vol); B.vol.connect(host.out);
      B.rv=ctx.createGain(); B.vol.connect(B.rv); B.rv.connect(host.verb);
      B.echo=H.echo(ctx); B.vol.connect(B.echo.in); B.echo.out.connect(host.out); B.echo.out.connect(B.rv);
      noise=H.noise(ctx,2); applyFx(true); return ctx;
    }
    function applyFx(first){
      if(!B)return; const t=ctx.currentTime, r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.1);
      r(B.vol.gain,Math.pow(st.vol/100,1.5)*1.1);
      const fz=st.fuzz/100; r(B.fzDry.gain,1-fz); r(B.fzPre.gain,1+fz*fz*35); r(B.fzWet.gain,fz*0.3);
      r(B.rv.gain,st.space/100*0.9);
      const ec=st.echo/100; B.echo.set(H.dotted8(host.bpm()),0.2+ec*0.55,ec*0.75);
    }
    const BODY={violin:[[290,4,1.2],[1050,3,2],[2800,5,1.5]],viola:[[220,4,1.4],[800,3,2.5],[2200,4,1.2]],sierra:[]};
    function Voice(){
      const v={}, tim=st.timbre;
      v.g=ctx.createGain(); v.g.gain.value=0.0001; v.lp=ctx.createBiquadFilter(); v.lp.type='lowpass'; v.lp.Q.value=0.8;
      let last=v.lp;
      if(tim==='voz'){const mix=ctx.createGain(); [[700,7,1],[1150,8,.7],[2700,10,.3]].forEach(([f,q,a])=>{const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=q; const ga=ctx.createGain(); ga.gain.value=a*3; v.lp.connect(bp); bp.connect(ga); ga.connect(mix)}); last=mix}
      else (BODY[tim]||[]).forEach(([f,q,db])=>{const pk=ctx.createBiquadFilter(); pk.type='peaking'; pk.frequency.value=f; pk.Q.value=q; pk.gain.value=db*3; last.connect(pk); last=pk});
      last.connect(v.g); v.g.connect(B.bus);
      v.vib=ctx.createOscillator(); v.vib.frequency.value=5.4+Math.random()*0.4; v.vibG=ctx.createGain(); v.vibG.gain.value=0; v.vib.connect(v.vibG); v.vib.start();
      v.oscs=[]; (tim==='sierra'?[['sawtooth',0],['square',-5],['sawtooth',7]]:[['sawtooth',-6],['sawtooth',6],['triangle',0]]).forEach(([ty,det])=>{
        const o=ctx.createOscillator(); o.type=ty; o.detune.value=det; v.vibG.connect(o.detune); const a=ctx.createGain(); a.gain.value=ty==='triangle'?0.3:0.38; o.connect(a); a.connect(v.lp); o.start(); v.oscs.push(o)});
      v.ns=ctx.createBufferSource(); v.ns.buffer=noise; v.ns.loop=true; const nb=ctx.createBiquadFilter(); nb.type='bandpass'; nb.frequency.value=3200; nb.Q.value=0.7; v.ng=ctx.createGain(); v.ng.gain.value=0; v.ns.connect(nb); nb.connect(v.ng); v.ng.connect(v.lp); v.ns.start();
      v.set=(m,y,glide,now)=>{const T=now?0.005:glide, tt=ctx.currentTime; v.oscs.forEach(o=>o.frequency.setTargetAtTime(H.mtof(m),tt,T));
        v.lp.frequency.setTargetAtTime(500+Math.pow(y,1.3)*(tim==='viola'?3500:6500),tt,0.05);
        v.g.gain.setTargetAtTime(0.12+y*0.5,tt,0.08); v.ng.gain.setTargetAtTime(tim==='sierra'?0:0.02+y*0.05,tt,0.08);
        v.vibG.gain.setTargetAtTime((st.vib/100)*(8+y*28),tt,0.4)};
      v.off=()=>{const tt=ctx.currentTime; v.g.gain.cancelScheduledValues(tt); v.g.gain.setTargetAtTime(0.0001,tt,0.25); const s=tt+1.6; v.oscs.forEach(o=>o.stop(s)); v.vib.stop(s); v.ns.stop(s); setTimeout(()=>{try{v.g.disconnect()}catch(e){}},1800)};
      return v;
    }
    const glideT=()=>st.glide==='free'?0.03:0.045;
    function posToMidi(x){const n=lanes.length,p=H.clamp(x,0,0.9999)*n-0.5;
      if(st.glide==='free'){const i=Math.floor(p),f=p-i; if(i<0)return lanes[0]; const a=lanes[H.clamp(i,0,n-1)],b=lanes[H.clamp(i+1,0,n-1)]; return a+(b-a)*f}
      return lanes[H.clamp(Math.round(p),0,n-1)]}

    const pad=root.querySelector('canvas.pad'); let live=null, liveM=null, trail=[];
    const loop={layers:[],L:0,start:0,rec:null};
    const rel=e=>{const r=pad.getBoundingClientRect(); return [(e.clientX-r.left)/r.width,1-(e.clientY-r.top)/r.height]};
    function ev(a,m,y){if(loop.rec){const now=performance.now()/1000; loop.rec.ev.push({t:loop.L?((now-loop.start)%loop.L):now-loop.rec.t0,a,m,y})}}
    pad.addEventListener('pointerdown',async e=>{
      e.preventDefault(); try{pad.setPointerCapture(e.pointerId)}catch(_){}
      try{await ready()}catch(_){H.toast('ESTE NAVEGADOR NO PUDO INICIAR EL AUDIO'); return}
      const [x,y]=rel(e), m=posToMidi(x), yy=H.clamp(y,0,1);
      if(live)live.off(); live=Voice(); live.set(m,yy,0,true); liveM=m; ev('on',m,yy);
      R('note').textContent=H.noteName(m); R('hint').textContent='Intensidad '+Math.round(yy*100)+'%'; trail.push([x,y,1]);
    });
    pad.addEventListener('pointermove',e=>{
      if(!live)return; const [x,y]=rel(e), m=posToMidi(x), yy=H.clamp(y,0,1);
      live.set(m,yy,glideT()); ev('move',m,yy); if(Math.round(m)!==Math.round(liveM))R('note').textContent=H.noteName(m); liveM=m;
      R('hint').textContent='Intensidad '+Math.round(yy*100)+'%'; trail.push([x,y,1]);
    });
    const up=()=>{if(!live)return; live.off(); live=null; ev('off',liveM,0); R('hint').textContent='Arrastrá el dedo por el panel'};
    ['pointerup','pointercancel','lostpointercapture'].forEach(n=>pad.addEventListener(n,up));

    function renderLayers(){
      R('layers').innerHTML=loop.layers.length?loop.layers.map((l,i)=>`<b>Capa ${i+1}</b>`).join('')+`<span>Vuelta de ${loop.L.toFixed(1).replace('.',',')} s</span>`
        :'<span>Grabá una frase: queda repitiendo y podés tocar otra encima (hasta 4 capas).</span>';
    }
    const recBtn=R('rec');
    recBtn.onclick=async()=>{
      try{await ready()}catch(_){}
      const now=performance.now()/1000;
      if(loop.rec){
        if(!loop.L){loop.L=Math.max(0.8,now-loop.rec.t0); loop.start=now; if(live)loop.rec.ev.push({t:loop.L-0.01,a:'off',m:liveM,y:0})}
        if(loop.rec.ev.length)loop.layers.push({ev:loop.rec.ev.sort((a,b)=>a.t-b.t),i:0,v:null,lap:-1});
        loop.rec=null; recBtn.textContent='● GRABAR OTRA CAPA'; recBtn.classList.remove('recording'); R('bar').classList.remove('rec'); renderLayers(); return;
      }
      if(loop.layers.length>=4){H.toast('MÁXIMO 4 CAPAS: DESHACÉ UNA'); return}
      loop.rec={t0:now,ev:[]}; if(live)ev('on',liveM,0.5);
      recBtn.textContent=loop.L?'■ TERMINAR CAPA':'■ CERRAR LA VUELTA'; recBtn.classList.add('recording'); R('bar').classList.add('rec');
      H.toast(loop.L?'GRABANDO ENCIMA: TOCÁ UNA VUELTA':'GRABANDO: TOCÁ Y CERRÁ LA VUELTA');
    };
    R('undo').onclick=()=>{const l=loop.layers.pop(); if(l&&l.v)l.v.off(); if(!loop.layers.length&&!loop.rec){loop.L=0; recBtn.textContent='● GRABAR FRASE'} renderLayers()};
    R('clear').onclick=()=>{loop.layers.forEach(l=>l.v&&l.v.off()); loop.layers=[]; loop.L=0; loop.rec=null; recBtn.textContent='● GRABAR FRASE'; recBtn.classList.remove('recording'); R('bar').classList.remove('rec'); renderLayers()};
    const tick=setInterval(()=>{
      if(!ctx||!loop.L)return; const now=performance.now()/1000, el=now-loop.start, lap=Math.floor(el/loop.L), t=el-lap*loop.L;
      if(loop.rec&&loop.layers.length&&now-loop.rec.t0>=loop.L)recBtn.click();
      loop.layers.forEach(l=>{
        if(l.lap!==lap){if(l.v){l.v.off(); l.v=null} l.i=0; l.lap=lap}
        while(l.i<l.ev.length&&l.ev[l.i].t<=t){const e=l.ev[l.i++];
          if(e.a==='on'){if(l.v)l.v.off(); l.v=Voice(); l.v.set(e.m,e.y,0,true)}
          else if(e.a==='move'&&l.v)l.v.set(e.m,e.y,glideT());
          else if(e.a==='off'&&l.v){l.v.off(); l.v=null}}
      });
    },12);

    const g=pad.getContext('2d'), W=120, Hh=126; let raf=0;
    function draw(){
      g.fillStyle=H.tok('raised'); g.fillRect(0,0,W,Hh);
      const n=lanes.length||15;
      for(let i=0;i<n;i++){const x=Math.round((i+0.5)*W/n); g.fillStyle=i%7===0?H.tok('accent-dark'):H.tok('line'); g.globalAlpha=i%7===0?0.9:0.55; for(let y=0;y<Hh;y+=2)g.fillRect(x,y,1,1)}
      g.globalAlpha=1;
      const fill=R('fill');
      if(loop.L)fill.style.width=(((performance.now()/1000-loop.start)%loop.L)/loop.L*100)+'%'; else if(loop.rec)fill.style.width=Math.min(100,(performance.now()/1000-loop.rec.t0)*10)+'%'; else fill.style.width='0';
      loop.layers.forEach((l,k)=>{if(!l.v)return; const e=l.ev[Math.max(0,l.i-1)]; if(!e)return; let idx=lanes.findIndex(m=>m>=e.m); if(idx<0)idx=n-1;
        g.fillStyle=[H.tok('flat'),H.tok('good'),H.tok('sharp'),H.tok('ink')][k%4]; g.globalAlpha=0.85; g.fillRect(Math.round((idx+0.5)*W/n)-2,Math.round((1-e.y)*Hh)-2,4,4)});
      g.globalAlpha=1; trail=trail.filter(p=>(p[2]-=0.04)>0);
      trail.forEach(p=>{g.globalAlpha=p[2]; g.fillStyle=H.tok('accent'); g.fillRect(Math.round(p[0]*W)-1,Math.round((1-p[1])*Hh)-1,3,3)});
      g.globalAlpha=1;
      if(live&&trail.length){const p=trail[trail.length-1]; g.fillStyle=H.tok('ink'); g.fillRect(Math.round(p[0]*W)-3,Math.round((1-p[1])*Hh)-3,7,7); g.fillStyle=H.tok('accent'); g.fillRect(Math.round(p[0]*W)-2,Math.round((1-p[1])*Hh)-2,5,5)}
      raf=requestAnimationFrame(draw);
    }
    host.on(()=>{buildLanes(); applyFx()});
    buildLanes(); renderLayers(); raf=requestAnimationFrame(draw);
    return {stop(){up(); loop.layers.forEach(l=>l.v&&l.v.off())}};
  }
  window.SVCapas.arco={title:'Arco',mount};
})();
