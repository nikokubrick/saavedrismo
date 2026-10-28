/* NIEBLA · SONIDOS ENCONTRADOS
   Materiales sonoros que se estiran para siempre y se afinan a cada nota del acorde:
   un grito, metal frotado con arco, una radio fantasma, aliento soplado y "tu sonido"
   (lo grabás con el micrófono o subís un archivo). Cada material se genera una vez,
   se le hace un bucle sin cortes (fundido cruzado) y cada nota lo reproduce en loop,
   con dos copias desfasadas para que nunca se note dónde empieza. */
(function(){
  'use strict';
  const TAU=Math.PI*2;
  const LIST=[
    {id:'grito', name:'Grito'},
    {id:'metal', name:'Metal'},
    {id:'radio', name:'Radio'},
    {id:'aliento', name:'Aliento'},
    {id:'tuyo', name:'Tu sonido'}
  ];
  const cache={};          // id -> {buf, base}
  let user=null;           // {buf, base, name}

  // ---------- utilidades ----------
  function rng(seed){let s=seed>>>0||1; return ()=>{s^=s<<13; s^=s>>>17; s^=s<<5; return ((s>>>0)/4294967296)}}
  function loopify(data,sr,X){ // data trae L+X muestras; devuelve L muestras que se repiten sin corte
    const L=data.length-X, out=new Float32Array(L);
    out.set(data.subarray(0,L));
    for(let i=0;i<X;i++){const t=i/X, a=Math.sin(t*Math.PI/2), b=Math.cos(t*Math.PI/2); out[i]=data[i]*a+data[L+i]*b}
    return out;
  }
  function normalize(d,peak=0.9){let m=0; for(let i=0;i<d.length;i++){const v=Math.abs(d[i]); if(v>m)m=v} if(m>0){const k=peak/m; for(let i=0;i<d.length;i++)d[i]*=k} return d}
  function biquadBP(f,q,sr){const w=TAU*f/sr, al=Math.sin(w)/(2*q), a0=1+al; return {b0:al/a0,b2:-al/a0,a1:-2*Math.cos(w)/a0,a2:(1-al)/a0,x1:0,x2:0,y1:0,y2:0,
    run(x){const y=this.b0*x+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2; this.x2=this.x1; this.x1=x; this.y2=this.y1; this.y1=y; return y}}}
  // envolvente de formantes (gaussianas en frecuencia)
  const formant=(f,F)=>F.reduce((s,[fc,bw,g])=>s+g*Math.exp(-0.5*Math.pow((f-fc)/bw,2)),0);
  function toBuffer(ctx,d){const b=ctx.createBuffer(1,d.length,ctx.sampleRate); b.copyToChannel?b.copyToChannel(d,0):b.getChannelData(0).set(d); return b}

  // ---------- materiales ----------
  // GRITO: voz femenina de terror, "aaaa" agudo con vibrato nervioso, aspereza y aire
  function genGrito(sr){
    const L=Math.round(sr*4), X=Math.round(sr*0.35), N=L+X, d=new Float32Array(N), r=rng(7);
    const base=660, F=[[980,230,1],[1450,300,.75],[2950,420,.55],[4100,500,.25]];
    const H=Math.floor(9000/base); const ph=new Float64Array(H+2), amp=new Float64Array(H+2); let sub=0;
    const bp=biquadBP(2600,0.8,sr), bp2=biquadBP(1100,1.2,sr);
    for(let i=0;i<N;i++){
      const t=i/sr;
      const vib=0.034*Math.sin(TAU*6.25*t)+0.012*Math.sin(TAU*0.5*t)+0.006*Math.sin(TAU*13.75*t+1)+0.004*Math.sin(TAU*23.5*t);
      const f0=base*(1+vib);
      if((i&31)===0)for(let k=1;k<=H;k++)amp[k]=f0*k>sr*0.45?0:formant(f0*k,F)*Math.pow(k,-0.35);
      let s=0;
      for(let k=1;k<=H;k++){ph[k]+=TAU*f0*k/sr; if(amp[k])s+=Math.sin(ph[k])*amp[k]}
      sub+=TAU*(f0/2)/sr; s+=0.18*Math.sin(sub)*formant(f0/2,[[600,300,1]]);      // aspereza (subarmónico)
      const am=1-0.32*(0.5+0.5*Math.sin(TAU*71.25*t+Math.sin(TAU*3.25*t)));        // ronquera
      const n=(r()*2-1); const air=bp.run(n)*0.55+bp2.run(n)*0.35;
      d[i]=Math.tanh(1.7*(s*0.22*am+air*0.35*(0.7+0.3*Math.sin(TAU*1.5*t))));
    }
    return {data:normalize(loopify(d,sr,X)),base};
  }
  // METAL: platillo / chapa frotada con arco: parciales inarmónicos que laten
  function genMetal(sr){
    const L=Math.round(sr*5), X=Math.round(sr*0.5), N=L+X, d=new Float32Array(N), r=rng(11);
    const base=220, P=[[1,1],[1.003,.6],[2.32,.55],[2.327,.35],[3.86,.42],[5.13,.3],[5.2,.2],[6.71,.22],[8.43,.14],[10.9,.09],[13.4,.06]];
    const ph=P.map(()=>r()*TAU), lfoR=P.map(()=>0.05+r()*0.35), lfoP=P.map(()=>r()*TAU);
    const hiss=biquadBP(5200,1.5,sr);
    for(let i=0;i<N;i++){
      const t=i/sr; let s=0;
      for(let j=0;j<P.length;j++){const [m,a]=P[j]; ph[j]+=TAU*base*m/sr; s+=Math.sin(ph[j])*a*(0.55+0.45*Math.sin(TAU*lfoR[j]*t+lfoP[j]))}
      const bow=0.85+0.15*Math.sin(TAU*0.4*t);
      d[i]=s*0.2*bow+hiss.run(r()*2-1)*0.05*bow;
    }
    return {data:normalize(loopify(d,sr,X)),base};
  }
  // RADIO: voces fantasma entre estaciones, estática y un silbido que deriva
  function genRadio(sr){
    const L=Math.round(sr*4), X=Math.round(sr*0.3), N=L+X, d=new Float32Array(N), r=rng(23);
    const base=196, H=Math.floor(3400/base), ph=new Float64Array(H+2), amp=new Float64Array(H+2);
    const V=[[[700,120,1],[1220,160,.6],[2600,250,.3]],[[300,90,1],[2300,200,.5],[3000,250,.25]],[[500,100,1],[900,140,.8],[2400,250,.25]],[[400,100,1],[1900,180,.6],[2600,250,.3]]];
    const lp=biquadBP(1500,0.6,sr), st1=biquadBP(3000,0.7,sr); let wh=0;
    for(let i=0;i<N;i++){
      const t=i/sr, syl=(t*4.25)%V.length, a=Math.floor(syl), fr=syl-a, A=V[a], B=V[(a+1)%V.length];
      const F=A.map((x,j)=>[x[0]+(B[j][0]-x[0])*fr,x[1],x[2]]);
      const f0=base*(1+0.05*Math.sin(TAU*0.75*t)+0.02*Math.sin(TAU*5*t));
      if((i&31)===0)for(let k=1;k<=H;k++)amp[k]=formant(f0*k,F);
      let s=0; for(let k=1;k<=H;k++){ph[k]+=TAU*f0*k/sr; s+=Math.sin(ph[k])*amp[k]}
      const gate=0.5+0.5*Math.sin(TAU*4.25*t);
      const fade=0.6+0.4*Math.sin(TAU*0.25*t);                 // la estación se va y vuelve
      wh+=TAU*(1300+180*Math.sin(TAU*0.25*t))/sr;
      const crack=r()<0.0008?(r()*2-1)*3:0;
      const n=st1.run(r()*2-1)*0.25+crack*0.3;
      d[i]=Math.tanh(1.3*(lp.run(s*0.25*gate*fade)*1.6+n*(1.1-fade)+0.05*Math.sin(wh)));
    }
    return {data:normalize(loopify(d,sr,X)),base};
  }
  // ALIENTO: soplido en una botella / flauta rota: aire que resuena en armónicos
  function genAliento(sr){
    const L=Math.round(sr*4), X=Math.round(sr*0.4), N=L+X, d=new Float32Array(N), r=rng(31);
    const base=392, R=[1,2,3,4,5].map((k,j)=>({f:biquadBP(base*k,38-j*5,sr),g:1/(1+j*0.9)}));
    let p=0;
    for(let i=0;i<N;i++){
      const t=i/sr, br=0.55+0.45*Math.pow(0.5+0.5*Math.sin(TAU*0.25*t-1.2),1.5);
      const n=(r()*2-1)*br; let s=0; for(const x of R)s+=x.f.run(n)*x.g;
      p+=TAU*base/sr;
      d[i]=s*1.8+Math.sin(p)*0.12*br+n*0.03;
    }
    return {data:normalize(loopify(d,sr,X)),base};
  }
  const GEN={grito:genGrito,metal:genMetal,radio:genRadio,aliento:genAliento};

  function material(ctx,id){
    if(id==='tuyo')return user;
    const k=id+'@'+ctx.sampleRate;
    if(!cache[k]){const m=GEN[id](ctx.sampleRate); cache[k]={buf:toBuffer(ctx,m.data),base:m.base}}
    return cache[k];
  }

  // ---------- reproducir: una voz por nota, dos copias desfasadas ----------
  function play(ctx,id,notes,input,norm,tape,mtof){
    const m=material(ctx,id); const srcs=[];
    if(!m){toastNS('GRABÁ O SUBÍ TU SONIDO PRIMERO'); return srcs}
    const dur=m.buf.duration;
    notes.forEach(n=>{
      let rate=mtof(n)/m.base; while(rate>1.6)rate/=2; while(rate<0.62)rate*=2;  // cada material conserva su carácter
      [0,0.5].forEach((off,j)=>{
        const s=ctx.createBufferSource(); s.buffer=m.buf; s.loop=true; s.playbackRate.value=rate;
        s.detune.value=(j?7:-7)+(Math.random()*6-3);
        if(tape)try{tape.connect(s.detune)}catch(e){}
        const a=ctx.createGain(); a.gain.value=norm*0.42; s.connect(a); a.connect(input);
        s.start(ctx.currentTime, (off+Math.random()*0.2)*dur%dur); srcs.push(s);
      });
    });
    return srcs;
  }

  // ---------- tu sonido: grabar o subir ----------
  function detectPitch(d,sr){
    const n=Math.min(4096,d.length), st=Math.max(0,Math.floor(d.length/2-n/2)), w=d.subarray(st,st+n);
    let best=-1,bl=0,e0=0; for(let i=0;i<n;i++)e0+=w[i]*w[i]; if(e0<1e-6)return 0;
    for(let lag=Math.floor(sr/1000);lag<Math.floor(sr/70);lag++){let c=0; for(let i=0;i+lag<n;i++)c+=w[i]*w[i+lag]; c/=e0; if(c>best){best=c; bl=lag}}
    return best>0.55?sr/bl:0;
  }
  function prepareUser(ctx,ab,name){
    const sr=ab.sampleRate, ch=ab.numberOfChannels, len=ab.length, mono=new Float32Array(len);
    for(let c=0;c<ch;c++){const x=ab.getChannelData(c); for(let i=0;i<len;i++)mono[i]+=x[i]/ch}
    let pk=0; for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(mono[i]));
    if(pk<0.003)throw new Error('silencio');
    const th=pk*0.06; let a=0,b=len-1; while(a<len&&Math.abs(mono[a])<th)a++; while(b>a&&Math.abs(mono[b])<th)b--;
    let seg=mono.subarray(a,b+1); const dur=seg.length/sr;
    if(dur>2.5){const s0=Math.floor(seg.length*0.12), s1=Math.floor(seg.length*0.9); seg=seg.subarray(s0,s1)}
    if(seg.length<sr*0.25)throw new Error('corto');
    const X=Math.min(Math.floor(seg.length*0.3),Math.floor(sr*0.6));
    const loop=normalize(loopify(Float32Array.from(seg),sr,X),0.85);
    const f=detectPitch(loop,sr)||261.63;
    // reescalar a la frecuencia del contexto si hace falta
    const buf=ctx.createBuffer(1,loop.length,sr); buf.getChannelData(0).set(loop);
    user={buf,base:f,name}; save(loop,sr,f,name);
    return user;
  }
  // guardar en el navegador para la próxima vez (si se puede)
  function idb(){return new Promise((ok,ko)=>{try{const r=indexedDB.open('niebla-hallados',1); r.onupgradeneeded=()=>r.result.createObjectStore('s'); r.onsuccess=()=>ok(r.result); r.onerror=()=>ko(r.error)}catch(e){ko(e)}})}
  async function save(d,sr,base,name){try{const db=await idb(); db.transaction('s','readwrite').objectStore('s').put({d,sr,base,name},'tuyo')}catch(e){}}
  async function load(ctx){try{const db=await idb(); const v=await new Promise(ok=>{const q=db.transaction('s').objectStore('s').get('tuyo'); q.onsuccess=()=>ok(q.result); q.onerror=()=>ok(null)});
    if(v&&v.d){const buf=ctx.createBuffer(1,v.d.length,v.sr); buf.getChannelData(0).set(v.d); user={buf,base:v.base,name:v.name}; status()}}catch(e){}}

  function toastNS(t){try{window.NS&&NS.toast&&NS.toast(t)}catch(e){}}
  let ui=null;
  function status(){if(!ui)return; ui.st.textContent=user?('Cargado: '+(user.name||'grabación')+' · '+Math.round(user.base)+' Hz'):'Todavía no hay sonido: grabá 5 segundos o subí un archivo.'}
  async function ctxReady(){return await NS.ensure()}
  async function record(){
    let stream;
    try{
      const devId=(window.NS_inputDeviceId&&NS_inputDeviceId())||undefined;
      stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:devId?{exact:devId}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    }catch(e){toastNS('NO SE PUDO USAR EL MICRÓFONO'); return}
    const ctx=await ctxReady();
    const rec=new MediaRecorder(stream), parts=[]; rec.ondataavailable=e=>parts.push(e.data);
    ui.rec.disabled=true; let left=5; ui.st.textContent='Grabando… '+left;
    const iv=setInterval(()=>{left--; if(left>0)ui.st.textContent='Grabando… '+left},1000);
    rec.onstop=async()=>{clearInterval(iv); stream.getTracks().forEach(t=>t.stop()); ui.rec.disabled=false;
      try{const ab=await ctx.decodeAudioData(await new Blob(parts).arrayBuffer()); prepareUser(ctx,ab,'grabación'); status(); retrig()}
      catch(e){ui.st.textContent='No se pudo usar la grabación ('+(e.message==='silencio'?'no se escuchó nada':'probá de nuevo')+').'}};
    rec.start(); setTimeout(()=>rec.state!=='inactive'&&rec.stop(),5000);
  }
  async function upload(file){
    if(!file)return; const ctx=await ctxReady(); ui.st.textContent='Cargando '+file.name+'…';
    try{const ab=await ctx.decodeAudioData(await file.arrayBuffer()); prepareUser(ctx,ab,file.name); status(); retrig()}
    catch(e){ui.st.textContent='No se pudo leer ese archivo. Probá con WAV, MP3 u OGG.'}
  }
  function retrig(){try{const a=NS.getActive(); if(a>=0){NS.release(); NS.press(a)}}catch(e){}}

  function mountUI(){
    const seg=document.getElementById('hallSeg'); if(!seg||ui)return;
    const box=document.createElement('div'); box.id='tuyoBox'; box.hidden=true;
    box.innerHTML='<div class="hall-row"><button class="btn" type="button" id="hallRec">● GRABAR 5 s</button><label class="btn" id="hallUp">SUBIR ARCHIVO<input type="file" accept="audio/*" hidden></label></div><p class="hint" id="hallSt"></p>';
    seg.insertAdjacentElement('afterend',box);
    ui={box,rec:box.querySelector('#hallRec'),st:box.querySelector('#hallSt')};
    ui.rec.onclick=record; box.querySelector('input').onchange=e=>upload(e.target.files[0]);
    const css=document.createElement('style'); css.textContent='#tuyoBox{margin-top:8px}.hall-row{display:flex;gap:8px;flex-wrap:wrap}.hall-row .btn{flex:1 1 0;text-align:center;cursor:pointer}#hallSt{margin:8px 0 0}';
    document.head.appendChild(css);
    status(); sync();
    if(window.NS&&NS.ctx)load(NS.ctx);
  }
  function sync(){if(ui&&window.NS)ui.box.hidden=NS.st.timbre!=='tuyo'}

  window.HALLADOS={LIST,has:id=>LIST.some(x=>x.id===id),play,sync,mountUI,onInit:ctx=>load(ctx),
    name:id=>(LIST.find(x=>x.id===id)||{}).name};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountUI); else setTimeout(mountUI,0);
})();
