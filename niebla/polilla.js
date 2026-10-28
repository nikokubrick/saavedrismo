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

/* POLILLA: caja de música o piano roto que repite un patrón y se va gastando */
(function(){
  const H=window.SVH;
  H.css('css-polilla',`
.polilla{display:grid; gap:14px}
.polilla .top{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
.polilla .top .btn{flex:1 1 140px}
.polilla .roll{padding:10px; display:grid; gap:4px}
.polilla .prow{display:grid; grid-template-columns:44px repeat(8,minmax(0,1fr)); gap:4px; align-items:center}
.polilla .prow > span{font:700 12px var(--f-mono); color:var(--muted); text-align:right; padding-right:4px}
.polilla .prow > span.root{color:var(--accent)}
.polilla .c{border:0; height:30px; padding:0; background:var(--raised); cursor:pointer; touch-action:manipulation; -webkit-tap-highlight-color:transparent; min-width:0}
.polilla .c:nth-of-type(odd){background:color-mix(in srgb,var(--ink) 9%,var(--raised))}
.polilla .c.on{background:var(--accent); box-shadow:inset -3px -3px 0 var(--accent-dark)}
.polilla .c.now{outline:2px solid var(--ink); outline-offset:-2px}
.polilla .wear{height:8px; background:var(--raised); overflow:hidden}
.polilla .wear i{display:block; height:100%; width:0; background:linear-gradient(90deg,var(--accent),var(--sharp))}`);

  function mount(root,host){
    const D={timbre:'caja',rate:'0.5',wear:25,auto:true,echo:35,space:60,vol:75,grid:null};
    const s0=H.store('polilla-saavedrista',D), st=s0.v, save=()=>s0.save();
    const ROWS=8, COLS=8;
    const DEMO=[[0,4],[1,2],[2,4],[3,5],[4,4],[5,2],[6,1],[7,0]]; // [col,row]
    if(!Array.isArray(st.grid)||st.grid.length!==ROWS){st.grid=Array.from({length:ROWS},()=>Array(COLS).fill(0)); DEMO.forEach(([c,r])=>st.grid[r][c]=1)}
    root.classList.add('polilla');
    root.innerHTML=`
      <div class="top"><button class="btn" data-r="play">▶ TOCAR</button><button class="btn ghost" data-r="new">NUEVA MELODÍA</button><button class="btn ghost sm" data-r="clr">VACIAR</button></div>
      <section class="roll px" data-r="roll"></section>
      <div class="seg term px" data-r="timbre"><button data-v="caja">Caja de música</button><button data-v="piano">Piano</button><button data-v="celesta">Celesta</button></div>
      <div class="seg term px" data-r="rate"><button data-v="1">Lento</button><button data-v="0.5">Normal</button><button data-v="0.25">Rápido</button></div>
      <div class="knobs px">
        <div class="row between"><span>Se va rompiendo solo</span><button class="toggle" data-r="auto">SÍ</button></div>
        <div class="wear" title="Desgaste"><i data-r="wearbar"></i></div>
        <div data-r="knobs" style="display:grid;gap:4px"></div>
      </div>`;
    const R=n=>root.querySelector(`[data-r="${n}"]`);
    let ctx=null,B=null,rows=[];
    function noteRows(){const sc=H.SCALE[host.mode()]; let base=60+host.key(); if(base>66)base-=12; rows=[]; for(let i=0;i<ROWS;i++)rows.push(base+sc[i%7]+12*Math.floor(i/7)); return rows}
    function renderRoll(){
      noteRows();
      R('roll').innerHTML=[...Array(ROWS).keys()].reverse().map(r=>`<div class="prow"><span class="${r%7===0?'root':''}">${H.NOTES[rows[r]%12]}</span>${st.grid[r].map((v,c)=>`<button class="c${v?' on':''}" data-row="${r}" data-col="${c}" aria-label="${H.NOTES[rows[r]%12]} paso ${c+1}" aria-pressed="${!!v}"></button>`).join('')}</div>`).join('');
    }
    R('roll').addEventListener('click',e=>{const b=e.target.closest('.c'); if(!b)return; const r=+b.dataset.row,c=+b.dataset.col; st.grid[r][c]=st.grid[r][c]?0:1; save(); b.classList.toggle('on'); b.setAttribute('aria-pressed',!!st.grid[r][c])});
    R('new').onclick=()=>{let r=Math.floor(Math.random()*4); st.grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
      for(let c=0;c<COLS;c++){if(Math.random()<0.18&&c>0)continue; r=H.clamp(r+[-2,-1,-1,0,1,1,2][Math.floor(Math.random()*7)],0,ROWS-1); st.grid[r][c]=1; if(Math.random()<0.15)st.grid[H.clamp(r+2,0,ROWS-1)][c]=1}
      save(); renderRoll()};
    R('clr').onclick=()=>{st.grid=Array.from({length:ROWS},()=>Array(COLS).fill(0)); save(); renderRoll()};
    H.seg(R('timbre'),'timbre',st,save); H.seg(R('rate'),'rate',st,save);
    const ab=R('auto'), ua=()=>{ab.setAttribute('aria-pressed',st.auto); ab.textContent=st.auto?'SÍ':'NO'}; ab.onclick=()=>{st.auto=!st.auto; save(); ua()}; ua();
    H.knobs(R('knobs'),[['wear','Desgaste',0,100,1],['echo','Eco',0,100,1],['space','Espacio',0,100,1],['vol','Volumen',0,100,1]],st,save,()=>applyFx());

    async function ready(){
      ctx=await host.ensure(); if(B)return;
      B={}; B.in=ctx.createGain();
      B.wow=ctx.createOscillator(); B.wow.frequency.value=0.6; B.wowG=ctx.createGain(); B.wow.connect(B.wowG); B.wow.start();
      // bitcrusher (escalera) en paralelo
      B.crush=ctx.createWaveShaper(); B.crushWet=ctx.createGain(); B.dry=ctx.createGain();
      B.lp=ctx.createBiquadFilter(); B.lp.type='lowpass'; B.lp.Q.value=0.5;
      B.in.connect(B.dry); B.dry.connect(B.lp); B.in.connect(B.crush); B.crush.connect(B.crushWet); B.crushWet.connect(B.lp);
      B.vol=ctx.createGain(); B.lp.connect(B.vol); B.vol.connect(host.out);
      B.rv=ctx.createGain(); B.vol.connect(B.rv); B.rv.connect(host.verb);
      B.echo=H.echo(ctx); B.vol.connect(B.echo.in); B.echo.out.connect(host.out); B.echo.out.connect(B.rv);
      B.hiss=ctx.createBufferSource(); B.hiss.buffer=H.noise(ctx,3); B.hiss.loop=true; const hb=ctx.createBiquadFilter(); hb.type='bandpass'; hb.frequency.value=3000; hb.Q.value=0.4; B.hissG=ctx.createGain(); B.hissG.gain.value=0; B.hiss.connect(hb); hb.connect(B.hissG); B.hissG.connect(B.vol); B.hiss.start();
      B.bits=-1; applyFx(true);
    }
    function applyFx(first){
      if(!B)return; const t=ctx.currentTime, r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.2), w=st.wear/100;
      r(B.vol.gain,Math.pow(st.vol/100,1.5)*1.3); r(B.rv.gain,st.space/100*0.9);
      const ec=st.echo/100; B.echo.set(H.dotted8(host.bpm()),0.15+ec*0.55,ec*0.7);
      r(B.wowG.gain,w*30); r(B.lp.frequency,9000*Math.pow(0.2,w)); r(B.hissG.gain,w*w*0.05);
      const bits=Math.round(12-w*8); if(bits!==B.bits){B.bits=bits; const n=Math.pow(2,bits), c=new Float32Array(1024); for(let i=0;i<1024;i++){const x=i/511.5-1; c[i]=Math.round(x*n/2)/(n/2)} B.crush.curve=c}
      r(B.crushWet.gain,Math.max(0,w-0.35)*1.3); r(B.dry.gain,1-Math.max(0,w-0.35)*0.9);
      R('wearbar').style.width=st.wear+'%';
    }
    function note(t,m,vel){
      const w=st.wear/100, f=H.mtof(m), g=ctx.createGain(), oscs=[];
      const det=(Math.random()*2-1)*w*30;
      const add=(type,mul,amp,dec)=>{const o=ctx.createOscillator(), a=ctx.createGain(); o.type=type; o.frequency.value=f*mul; o.detune.value=det; B.wowG.connect(o.detune);
        a.gain.setValueAtTime(0.0001,t); a.gain.exponentialRampToValueAtTime(amp*vel,t+0.004); a.gain.exponentialRampToValueAtTime(0.0001,t+dec);
        o.connect(a); a.connect(B.in); o.start(t); o.stop(t+dec+0.05); oscs.push(o)};
      if(st.timbre==='caja'){add('sine',1,0.42,1.8); add('sine',2,0.12,0.9); add('sine',5.4,0.06,0.25)}
      else if(st.timbre==='piano'){add('triangle',1,0.36,2.6); add('sine',2,0.16,1.6); add('sawtooth',1,0.04,0.5); add('sine',3,0.05,0.8)}
      else {add('sine',1,0.38,2.2); add('sine',4,0.1,0.6); add('sine',2.01,0.08,1.2)}
    }
    // secuenciador
    let playing=false, nextT=0, step=0, timer=0, q=[], bars=0;
    function sched(){
      if(!playing)return; const dur=60/host.bpm()*(+st.rate);
      while(nextT<ctx.currentTime+0.12){
        const w=st.wear/100;
        for(let r=0;r<ROWS;r++)if(st.grid[r][step]){ if(Math.random()<w*0.22)continue; note(nextT+(Math.random()*w*0.03),rows[r],0.75+Math.random()*0.25*(1-w)) }
        q.push([nextT,step]); nextT+=dur; step=(step+1)%COLS;
        if(step===0){bars++; if(st.auto&&st.wear<100&&bars%2===0){st.wear=Math.min(100,st.wear+3); save(); const k=root.querySelector('[data-k="wear"]'),o=root.querySelector('[data-o="wear"]'); if(k){k.value=st.wear; o.textContent=st.wear} applyFx()}}
      }
    }
    const playBtn=R('play');
    playBtn.onclick=async()=>{
      try{await ready()}catch(e){H.toast('ESTE NAVEGADOR NO PUDO INICIAR EL AUDIO'); return}
      if(playing){playing=false; clearInterval(timer); q=[]; playBtn.textContent='▶ TOCAR'; playBtn.classList.remove('running'); mark(-1); return}
      noteRows(); playing=true; step=0; bars=0; nextT=ctx.currentTime+0.06; sched(); timer=setInterval(sched,25);
      playBtn.textContent='■ PARAR'; playBtn.classList.add('running');
    };
    let last=-1; function mark(c){if(c===last)return; last=c; root.querySelectorAll('.c.now').forEach(b=>b.classList.remove('now')); if(c>=0)root.querySelectorAll(`.c[data-col="${c}"]`).forEach(b=>b.classList.add('now'))}
    (function vis(){if(playing&&ctx){while(q.length&&q[0][0]<=ctx.currentTime)mark(q.shift()[1])} requestAnimationFrame(vis)})();
    host.on(()=>{renderRoll(); applyFx()});
    renderRoll();
    return {stop(){if(playing)playBtn.click()}};
  }
  window.SVCapas.polilla={title:'Polilla',mount};
})();
