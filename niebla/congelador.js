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

/* CONGELADOR: graba tu voz o tu instrumento y lo convierte en una nube de sonido congelada */
(function(){
  const H=window.SVH;
  H.css('css-congelador',`
.congelador{display:grid; gap:14px}
.congelador .src{display:flex; gap:10px; flex-wrap:wrap}
.congelador .src .btn{flex:1 1 130px}
.congelador .wave{padding:8px; display:grid; gap:6px}
.congelador canvas.wv{width:100%; height:120px; display:block; background:var(--raised); touch-action:none; cursor:pointer; image-rendering:pixelated}
.congelador .wave .info{display:flex; justify-content:space-between; gap:10px; font-size:13.5px; color:var(--muted)}
.congelador .rec.recording{background:var(--sharp); color:#fff}`);

  function mount(root,host){
    const s0=H.store('congelador-saavedrista',{pos:35,size:220,dens:18,pitch:0,spread:12,drift:20,rev:false,space:75,vol:75}), st=s0.v, save=()=>s0.save();
    root.classList.add('congelador');
    root.innerHTML=`
      <div class="src">
        <button class="btn ghost rec" data-r="mic">● GRABAR CON EL MICRÓFONO</button>
        <button class="btn ghost" data-r="file">CARGAR UN AUDIO</button>
        <input type="file" accept="audio/*" data-r="input" hidden>
      </div>
      <section class="wave px">
        <canvas class="wv" width="240" height="60" data-r="cv" aria-label="Forma de onda: tocá o arrastrá para elegir qué parte congelar"></canvas>
        <div class="info"><span data-r="name">Sonido de ejemplo</span><span>Tocá la onda para elegir la parte</span></div>
      </section>
      <div class="row"><button class="btn" data-r="play">▶ CONGELAR</button><button class="toggle" data-r="rev">REVERSA</button></div>
      <div class="knobs px" data-r="knobs"></div>`;
    const R=n=>root.querySelector(`[data-r="${n}"]`);
    let ctx=null,B=null,buf=null,rbuf=null,name='Sonido de ejemplo',peaks=null;
    const rb=R('rev'),ur=()=>{rb.setAttribute('aria-pressed',st.rev)}; rb.onclick=()=>{st.rev=!st.rev; save(); ur()}; ur();
    H.knobs(R('knobs'),[['pos','Posición',0,100,1],['size','Tamaño',30,800,5,v=>v+' ms'],['dens','Densidad',2,60,1,v=>v+'/s'],['pitch','Afinación',-12,12,1,v=>(v>0?'+':'')+v],['spread','Dispersión',0,100,1],['drift','Movimiento',0,100,1],['space','Espacio',0,100,1],['vol','Volumen',0,100,1]],st,save,()=>applyFx());

    async function ready(){
      ctx=await host.ensure(); if(B)return;
      B={}; B.vol=ctx.createGain(); B.vol.connect(host.out); B.rv=ctx.createGain(); B.vol.connect(B.rv); B.rv.connect(host.verb);
      if(!buf)setBuffer(demo(),'Sonido de ejemplo');
      applyFx(true);
    }
    function applyFx(first){if(!B)return; const t=ctx.currentTime,r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.1); r(B.vol.gain,Math.pow(st.vol/100,1.5)*2.2); r(B.rv.gain,st.space/100)}
    // sonido de ejemplo: un acorde de cuerdas con vibrato, generado acá mismo
    function demo(){
      const sr=ctx.sampleRate, len=sr*5, b=ctx.createBuffer(1,len,sr), d=b.getChannelData(0), sc=H.SCALE[host.mode()], r=57+((host.key()-9+12)%12);
      const notes=[r,r+sc[2],r+sc[4],r+12];
      notes.forEach((m,k)=>{const f=H.mtof(m); let ph=0; for(let i=0;i<len;i++){const t=i/sr, vib=1+0.004*Math.sin(2*Math.PI*5.2*t+k), env=Math.min(1,t/0.6)*Math.min(1,(5-t)/0.8)*(0.6+0.4*Math.sin(t*1.3+k)); ph+=2*Math.PI*f*vib/sr; let s=0; for(let h=1;h<=6;h++)s+=Math.sin(ph*h)/h; d[i]+=s*env*0.12}});
      return b;
    }
    function setBuffer(b,n){
      buf=b; name=n; R('name').textContent=n+' · '+b.duration.toFixed(1).replace('.',',')+' s';
      rbuf=ctx.createBuffer(b.numberOfChannels,b.length,b.sampleRate); for(let c=0;c<b.numberOfChannels;c++){const s=b.getChannelData(c),d=rbuf.getChannelData(c); for(let i=0;i<s.length;i++)d[i]=s[s.length-1-i]}
      const W=240, d=b.getChannelData(0), step=Math.floor(d.length/W); peaks=new Float32Array(W); for(let x=0;x<W;x++){let m=0; for(let i=x*step;i<(x+1)*step&&i<d.length;i++)m=Math.max(m,Math.abs(d[i])); peaks[x]=m}
      const mx=Math.max(...peaks)||1; for(let x=0;x<W;x++)peaks[x]/=mx;
    }
    // micrófono
    let mrec=null, mstream=null, mt0=0, mtimer=0;
    R('mic').onclick=async()=>{
      try{await ready()}catch(e){return}
      if(mrec){mrec.stop(); return}
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){H.toast('ESTE NAVEGADOR NO DA ACCESO AL MICRÓFONO'); return}
      try{mstream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})}
      catch(e){H.toast(e&&e.name==='NotAllowedError'?'SIN PERMISO DE MICRÓFONO: USÁ CARGAR UN AUDIO':'NO SE PUDO ABRIR EL MICRÓFONO'); return}
      const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
      const chunks=[]; try{mrec=new MediaRecorder(mstream,type?{mimeType:type}:undefined)}catch(e){H.toast('ESTE NAVEGADOR NO PUEDE GRABAR'); return}
      mrec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
      mrec.onstop=async()=>{clearTimeout(mtimer); mstream.getTracks().forEach(t=>t.stop()); const btn=R('mic'); btn.textContent='● GRABAR CON EL MICRÓFONO'; btn.classList.remove('recording');
        try{const ab=await new Blob(chunks,{type:mrec.mimeType||type}).arrayBuffer(); const b=await new Promise((res,rej)=>{const p=ctx.decodeAudioData(ab,res,rej); if(p&&p.then)p.then(res,rej)}); setBuffer(b,'Tu grabación'); H.toast('LISTO: TOCÁ CONGELAR')}catch(e){H.toast('NO SE PUDO LEER LA GRABACIÓN')}
        mrec=null};
      mrec.start(); mt0=Date.now(); const btn=R('mic'); btn.textContent='■ PARAR (MÁX. 10 S)'; btn.classList.add('recording'); mtimer=setTimeout(()=>{if(mrec)mrec.stop()},10000);
    };
    R('file').onclick=()=>R('input').click();
    R('input').onchange=async()=>{const f=R('input').files[0]; R('input').value=''; if(!f)return; try{await ready(); const ab=await f.arrayBuffer(); const b=await new Promise((res,rej)=>{const p=ctx.decodeAudioData(ab,res,rej); if(p&&p.then)p.then(res,rej)}); setBuffer(b,f.name.slice(0,30)); H.toast('LISTO: TOCÁ CONGELAR')}catch(e){H.toast('NO PUDE ABRIR ESE AUDIO. PROBÁ CON MP3, WAV O M4A')}};

    // motor granular
    let playing=false,nextT=0,timer=0,drift=0,flashes=[];
    function grain(t){
      const len=buf.duration, size=st.size/1000, rate=Math.pow(2,st.pitch/12)*(1+(Math.random()*2-1)*0.004*st.spread/100);
      let p=st.pos/100+drift+(Math.random()*2-1)*st.spread/100*0.25; p=((p%1)+1)%1;
      const rev=st.rev&&Math.random()<0.5, src=ctx.createBufferSource(); src.buffer=rev?rbuf:buf; src.playbackRate.value=rate;
      let off=p*len; if(rev)off=len-off; off=H.clamp(off,0,Math.max(0,len-size*rate-0.01));
      const g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.6,t+size/2); g.gain.linearRampToValueAtTime(0,t+size);
      let node=g; if(ctx.createStereoPanner){const pn=ctx.createStereoPanner(); pn.pan.value=(Math.random()*2-1)*0.7; g.connect(pn); node=pn}
      src.connect(g); node.connect(B.vol); src.start(t,off,size*rate+0.02); src.stop(t+size+0.05);
      flashes.push([p,t]);
    }
    function sched(){
      if(!playing)return;
      drift+=(st.drift/100)*0.0009*(Math.random()<0.5?-1:1)+Math.sin(performance.now()/7000)*0.0004*st.drift/100;
      drift=H.clamp(drift,-0.3,0.3);
      while(nextT<ctx.currentTime+0.1){grain(nextT); nextT+=(1/st.dens)*(0.7+Math.random()*0.6)}
    }
    const pb=R('play');
    pb.onclick=async()=>{
      try{await ready()}catch(e){H.toast('ESTE NAVEGADOR NO PUDO INICIAR EL AUDIO'); return}
      if(playing){playing=false; clearInterval(timer); pb.textContent='▶ CONGELAR'; pb.classList.remove('running'); return}
      playing=true; nextT=ctx.currentTime+0.05; sched(); timer=setInterval(sched,20); pb.textContent='■ DESCONGELAR'; pb.classList.add('running');
    };
    // forma de onda
    const cv=R('cv'), g=cv.getContext('2d'), W=240, Hh=60;
    function setPos(e){const r=cv.getBoundingClientRect(); st.pos=Math.round(H.clamp((e.clientX-r.left)/r.width,0,1)*100); drift=0; save(); const k=root.querySelector('[data-k="pos"]'),o=root.querySelector('[data-o="pos"]'); if(k){k.value=st.pos; o.textContent=st.pos}}
    let drag=false; cv.addEventListener('pointerdown',e=>{drag=true; try{cv.setPointerCapture(e.pointerId)}catch(_){} setPos(e)}); cv.addEventListener('pointermove',e=>{if(drag)setPos(e)}); ['pointerup','pointercancel'].forEach(n=>cv.addEventListener(n,()=>drag=false));
    (function draw(){
      g.fillStyle=H.tok('raised'); g.fillRect(0,0,W,Hh);
      g.fillStyle=H.tok('muted');
      if(peaks)for(let x=0;x<W;x++){const h=Math.max(1,Math.round(peaks[x]*(Hh/2-3))); g.fillRect(x,Hh/2-h,1,h*2)}
      else{g.globalAlpha=.5; g.fillRect(0,Hh/2,W,1); g.globalAlpha=1}
      const p=(((st.pos/100+drift)%1)+1)%1, sw=Math.max(2,st.spread/100*0.5*W);
      g.fillStyle=H.tok('accent'); g.globalAlpha=0.18; g.fillRect(Math.round(p*W-sw/2),0,Math.round(sw),Hh); g.globalAlpha=1; g.fillRect(Math.round(p*W),0,1,Hh);
      if(ctx){const now=ctx.currentTime; flashes=flashes.filter(f=>now-f[1]<0.4); flashes.forEach(f=>{if(f[1]>now)return; g.globalAlpha=1-(now-f[1])/0.4; g.fillStyle=H.tok('ink'); g.fillRect(Math.round(f[0]*W),Math.round(4+Math.random()*(Hh-8)),2,2)}); g.globalAlpha=1}
      requestAnimationFrame(draw)})();
    let lastK=host.key()+host.mode();
    host.on(()=>{const k=host.key()+host.mode(); if(k===lastK)return; lastK=k; if(buf&&name==='Sonido de ejemplo'&&ctx)setBuffer(demo(),'Sonido de ejemplo')});
    return {stop(){if(playing)pb.click()}};
  }
  window.SVCapas.congelador={title:'Congelador',mount};
})();
