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

/* ENGRANAJE: arpegiador que recorre las notas del acorde de Niebla */
(function(){
  const H=window.SVH;
  H.css('css-engranaje',`
.engranaje{display:grid; gap:14px}
.engranaje .top{display:flex; gap:10px; flex-wrap:wrap}
.engranaje .top .btn{flex:1 1 140px}
.engranaje .scr{padding:12px; display:grid; gap:10px}
.engranaje .scr .info{display:flex; justify-content:space-between; align-items:baseline; gap:10px}
.engranaje .scr b{font:700 24px var(--f-mono)}
.engranaje .scr span{font-size:13.5px; color:var(--muted); text-align:right}
.engranaje .dots{display:flex; gap:6px; flex-wrap:wrap; min-height:28px}
.engranaje .dots i{width:22px; height:22px; background:var(--raised); display:block}
.engranaje .dots i.hit{background:var(--accent); box-shadow:inset -3px -3px 0 var(--accent-dark)}`);

  function mount(root,host){
    const s0=H.store('engranaje-saavedrista',{pat:'up',rate:'0.5',oct:'2',timbre:'pulso',gate:45,cut:45,res:35,move:40,echo:45,space:55,vol:70}), st=s0.v, save=()=>s0.save();
    root.classList.add('engranaje');
    root.innerHTML=`
      <div class="top"><button class="btn" data-r="play">▶ ARPEGIAR</button></div>
      <section class="scr px"><div class="info"><b data-r="chord">—</b><span data-r="src"></span></div><div class="dots" data-r="dots"></div></section>
      <div class="seg term px" data-r="pat"><button data-v="up">Arriba</button><button data-v="down">Abajo</button><button data-v="updown">Ida y vuelta</button><button data-v="rand">Azar</button></div>
      <div class="seg term px" data-r="rate"><button data-v="0.5">Corcheas</button><button data-v="0.3333">Tresillos</button><button data-v="0.25">Semicorch.</button></div>
      <div class="seg term px" data-r="oct"><button data-v="1">1 octava</button><button data-v="2">2 octavas</button><button data-v="3">3 octavas</button></div>
      <div class="seg term px" data-r="timbre"><button data-v="pulso">Pulso</button><button data-v="cuerda">Cuerda</button><button data-v="vidrio">Vidrio</button></div>
      <div class="knobs px" data-r="knobs"></div>`;
    const R=n=>root.querySelector(`[data-r="${n}"]`);
    let ctx=null,B=null;
    ['pat','rate','oct','timbre'].forEach(k=>H.seg(R(k),k,st,save,()=>{idx=0;dir=1}));
    H.knobs(R('knobs'),[['gate','Duración',5,100,1],['cut','Filtro',0,100,1],['res','Resonancia',0,100,1],['move','Movimiento',0,100,1],['echo','Eco',0,100,1],['space','Espacio',0,100,1],['vol','Volumen',0,100,1]],st,save,()=>applyFx());

    function chordNotes(){
      const c=host.chord&&host.chord();
      if(c&&c.notes&&c.notes.length)return {notes:[...new Set(c.notes.map(m=>{let x=m; while(x<57)x+=12; while(x>72)x-=12; return x}))].sort((a,b)=>a-b),name:c.name,src:'Siguiendo el acorde de Niebla'};
      const sc=H.SCALE[host.mode()], r=57+((host.key()-9+12)%12);
      return {notes:[r,r+sc[2],r+sc[4]],name:H.NOTES[host.key()]+(host.mode()==='minor'?'m':''),src:'Sin acorde en Niebla: uso el de la tonalidad'};
    }
    function seq(){const c=chordNotes(), o=+st.oct, all=[]; for(let k=0;k<o;k++)c.notes.forEach(m=>all.push(m+12*k)); return {c,all}}
    function renderScr(){const {c,all}=seq(); R('chord').textContent=c.name; R('src').textContent=c.src; R('dots').innerHTML=all.map(()=>'<i></i>').join('')}

    async function ready(){
      ctx=await host.ensure(); if(B)return;
      B={}; B.f=ctx.createBiquadFilter(); B.f.type='lowpass';
      B.lfo=ctx.createOscillator(); B.lfo.frequency.value=0.11; B.lfoG=ctx.createGain(); B.lfo.connect(B.lfoG); B.lfoG.connect(B.f.frequency); B.lfo.start();
      B.vol=ctx.createGain(); B.f.connect(B.vol); B.vol.connect(host.out);
      B.rv=ctx.createGain(); B.vol.connect(B.rv); B.rv.connect(host.verb);
      B.echo=H.echo(ctx); B.vol.connect(B.echo.in); B.echo.out.connect(host.out); B.echo.out.connect(B.rv);
      applyFx(true);
    }
    function applyFx(first){
      if(!B)return; const t=ctx.currentTime, r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.1);
      const cut=250*Math.pow(40,st.cut/100); r(B.f.frequency,cut); r(B.f.Q,0.5+st.res/100*14); r(B.lfoG.gain,cut*0.8*st.move/100);
      r(B.vol.gain,Math.pow(st.vol/100,1.5)*1.9); r(B.rv.gain,st.space/100*0.9);
      const ec=st.echo/100; B.echo.set(H.dotted8(host.bpm()),0.2+ec*0.55,ec*0.7);
    }
    function hit(t,m,len){
      const f=H.mtof(m), g=ctx.createGain(), dec=Math.max(0.06,len);
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.004);
      g.gain.setValueAtTime(0.5,t+dec*0.3); g.gain.exponentialRampToValueAtTime(0.0001,t+dec+0.15); g.connect(B.f);
      const os=st.timbre==='pulso'?[['sawtooth',1,0.35],['square',0.5,0.18]]:st.timbre==='cuerda'?[['triangle',1,0.5],['sawtooth',1,0.08]]:[['sine',1,0.45],['sine',3.01,0.1]];
      os.forEach(([ty,mul,a])=>{const o=ctx.createOscillator(),ga=ctx.createGain(); o.type=ty; o.frequency.value=f*mul; o.detune.value=Math.random()*6-3; ga.gain.value=a; o.connect(ga); ga.connect(g); o.start(t); o.stop(t+dec+0.2)});
    }
    let playing=false,nextT=0,idx=0,dir=1,timer=0,q=[];
    function pick(n){
      if(st.pat==='rand')return Math.floor(Math.random()*n);
      if(st.pat==='down'){const i=(n-1)-(idx%n); idx++; return i}
      if(st.pat==='updown'){if(n<2)return 0; const i=idx; idx+=dir; if(idx>=n-1||idx<=0)dir*=-1; idx=H.clamp(idx,0,n-1); return H.clamp(i,0,n-1)}
      const i=idx%n; idx++; return i;
    }
    function sched(){
      if(!playing)return;
      while(nextT<ctx.currentTime+0.12){
        const {all}=seq(), n=all.length, i=pick(n), dur=60/host.bpm()*(+st.rate);
        hit(nextT,all[i],dur*st.gate/100*1.6); q.push([nextT,i]); nextT+=dur;
      }
    }
    const pb=R('play');
    pb.onclick=async()=>{
      try{await ready()}catch(e){H.toast('ESTE NAVEGADOR NO PUDO INICIAR EL AUDIO'); return}
      if(playing){playing=false; clearInterval(timer); q=[]; pb.textContent='▶ ARPEGIAR'; pb.classList.remove('running'); return}
      playing=true; idx=0; dir=1; nextT=ctx.currentTime+0.06; sched(); timer=setInterval(sched,25); pb.textContent='■ PARAR'; pb.classList.add('running');
    };
    let lastKey='';
    (function vis(){
      if(ctx&&playing){while(q.length&&q[0][0]<=ctx.currentTime){const i=q.shift()[1]; const ds=R('dots').children; [...ds].forEach((d,k)=>d.classList.toggle('hit',k===i))}}
      const {all,c}=seq(), k=c.name+all.length; if(k!==lastKey){lastKey=k; renderScr()}
      requestAnimationFrame(vis)})();
    host.on(()=>{renderScr(); applyFx()});
    renderScr();
    return {stop(){if(playing)pb.click()}};
  }
  window.SVCapas.engranaje={title:'Engranaje',mount};
})();
