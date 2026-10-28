/* NIEBLA STUDIO · vocoder de 16 bandas: tu micrófono "canta" los acordes de Niebla o las notas de tu teclado */
(function(){
  const NS=window.NS, $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mtof=m=>440*Math.pow(2,(m-69)/12);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DEF={on:false,src:'both',wave:'saw',oct:0,mic:50,sib:50,form:0,smooth:50,vol:70};
  let V=Object.assign({},DEF); try{Object.assign(V,JSON.parse(localStorage.getItem('niebla-studio-vocoder')||'{}'))}catch(e){} V.on=false;
  const save=()=>{try{localStorage.setItem('niebla-studio-vocoder',JSON.stringify(V))}catch(e){}};
  const NB=16, F0=140, F1=7600, Q=4.2;
  const freqs=Array.from({length:NB},(_,i)=>F0*Math.pow(F1/F0,i/(NB-1)));

  const mount=$('studioMount');
  const sec=document.createElement('div');
  const knob=(id,label,min,max,step,val)=>`<label class="k"><span>${label}</span><input type="range" id="vk_${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="Vocoder · ${label}"><output id="o_vk_${id}"></output></label>`;
  sec.innerHTML=`
    <h2 class="lbl">VOCODER</h2>
    <section class="px voc">
      <p class="hint">Tu voz (o cualquier sonido que entre por el micrófono) controla un sintetizador que toca <b>las notas que elijas</b>: así hablás o cantás con voz de robot sobre los acordes. Necesita <b>auriculares</b>: la voz solo se oye a través del vocoder.</p>
      <div class="row"><button class="btn" id="vocOn">▶ ACTIVAR VOCODER</button><span class="status" id="vocState">APAGADO</span></div>
      <h3 class="sub">QUÉ NOTAS CANTA</h3>
      <div class="seg term px" id="vocSrc" role="group" aria-label="Notas del vocoder"><button data-v="teclas">Mis teclas MIDI</button><button data-v="niebla">Acorde de Niebla</button><button data-v="both">Los dos</button></div>
      <div class="seg term px" id="vocWave" role="group" aria-label="Sonido del vocoder"><button data-v="saw">Sierra</button><button data-v="coro">Coro (3 sierras)</button><button data-v="pulso">Pulso</button></div>
      <div class="seg term px" id="vocOct" role="group" aria-label="Octava del vocoder"><button data-v="-1">Octava −1</button><button data-v="0">Octava 0</button><button data-v="1">Octava +1</button></div>
      <div class="knobs px">${knob('mic','Entrada',0,100,1,V.mic)}${knob('sib','Aire (s, t, f)',0,100,1,V.sib)}${knob('form','Formante',-12,12,1,V.form)}${knob('smooth','Suavizado',0,100,1,V.smooth)}${knob('vol','Nivel',0,100,1,V.vol)}</div>
      <p class="hint" id="vocMsg">Elegí tu micrófono o tu interfaz en «Audio · micrófono e interfaz». Tocá un acorde en Niebla o una tecla de tu teclado y hablá.</p>
    </section>`;
  mount.appendChild(sec);

  const fmt={mic:v=>v,sib:v=>v,form:v=>(v>0?'+':'')+v+' st',smooth:v=>v,vol:v=>v};
  ['mic','sib','form','smooth','vol'].forEach(id=>{const el=$('vk_'+id), out=$('o_vk_'+id); el.value=V[id]; out.textContent=fmt[id](V[id]);
    el.addEventListener('input',()=>{V[id]=+el.value; out.textContent=fmt[id](V[id]); save(); apply()})});
  const seg=(id,key,num)=>{const bs=document.querySelectorAll('#'+id+' button'); const u=()=>bs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v)===String(V[key])));
    bs.forEach(b=>b.onclick=()=>{V[key]=num?+b.dataset.v:b.dataset.v; save(); u(); sync(true)}); u()};
  seg('vocSrc','src'); seg('vocWave','wave'); seg('vocOct','oct',true);

  /* ---- grafo de audio ---- */
  let ctx=null, G=null, stream=null, micSrc=null;
  const abs=(()=>{const c=new Float32Array(1024); for(let i=0;i<1024;i++)c[i]=Math.abs(i/511.5-1); return c})();
  const rect=()=>{const w=ctx.createWaveShaper(); w.curve=abs; return w};
  function build(){
    if(G)return; const N=NS.nodes; G={};
    G.mic=ctx.createGain(); const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=90; G.mic.connect(hp);
    G.carrier=ctx.createGain(); G.carrier.gain.value=0.5;
    G.out=ctx.createGain(); G.bands=[];
    freqs.forEach((f,i)=>{
      const a=ctx.createBiquadFilter(); a.type='bandpass'; a.frequency.value=f; a.Q.value=Q; hp.connect(a);
      const r=rect(), lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.5; lp.frequency.value=40; const k=ctx.createGain(); k.gain.value=26*(0.8+0.4*i/NB);
      a.connect(r); r.connect(lp); lp.connect(k);
      const s=ctx.createBiquadFilter(); s.type='bandpass'; s.frequency.value=f; s.Q.value=Q; const bg=ctx.createGain(); bg.gain.value=0;
      G.carrier.connect(s); s.connect(bg); k.connect(bg.gain); bg.connect(G.out);
      G.bands.push({a,s,lp,k});
    });
    // sibilantes: ruido blanco controlado por la energía de agudos de la voz
    const nb=ctx.createBufferSource(); const len=ctx.sampleRate*2, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0); for(let i=0;i<len;i++)d[i]=Math.random()*2-1; nb.buffer=buf; nb.loop=true;
    const nhp=ctx.createBiquadFilter(); nhp.type='highpass'; nhp.frequency.value=4800; G.noiseG=ctx.createGain(); G.noiseG.gain.value=0; nb.connect(nhp); nhp.connect(G.noiseG); G.noiseG.connect(G.out); nb.start();
    const sh=ctx.createBiquadFilter(); sh.type='highpass'; sh.frequency.value=5200; const sr=rect(), sl=ctx.createBiquadFilter(); sl.type='lowpass'; sl.frequency.value=45; G.sibK=ctx.createGain(); G.sibK.gain.value=7;
    hp.connect(sh); sh.connect(sr); sr.connect(sl); sl.connect(G.sibK); G.sibK.connect(G.noiseG.gain);
    G.vol=ctx.createGain(); G.out.connect(G.vol); G.vol.connect(N.ch_vocoder.in); G.send=ctx.createGain(); G.send.gain.value=0.35; G.vol.connect(G.send); G.send.connect(N.ch_vocoder.vIn);
    G.voices=new Map();
    apply(true);
  }
  function apply(first){
    if(!G)return; const t=ctx.currentTime, r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.06);
    r(G.mic.gain,0.4+Math.pow(V.mic/100,1.6)*14);
    r(G.vol.gain,Math.pow(V.vol/100,1.5)*1.6);
    const sm=15+(100-V.smooth)*1.05, ratio=Math.pow(2,V.form/12);
    G.bands.forEach((b,i)=>{r(b.lp.frequency,sm); r(b.a.frequency,clamp(freqs[i]*ratio,60,12000))});
    r(G.sibK.gain,V.sib/100*14);
  }

  /* ---- notas del portador ---- */
  function wanted(){
    let ns=[];
    if(V.src!=='niebla'&&window.NSKeys)ns=ns.concat(window.NSKeys.heldNotes());
    if(V.src!=='teclas'&&NS.getActive()>=0)ns=ns.concat(NS.chordFor(NS.getActive()).notes);
    const set=new Set(ns.map(n=>{let x=n; while(x>72)x-=12; while(x<40)x+=12; return x+12*V.oct}));
    return [...set].sort((a,b)=>a-b).slice(0,8);
  }
  function startNote(m){
    const f=mtof(m), g=ctx.createGain(), oscs=[], t=ctx.currentTime;
    const mk=(type,fr,det,amp)=>{const o=ctx.createOscillator(); o.type=type; o.frequency.value=fr; o.detune.value=det; const a=ctx.createGain(); a.gain.value=amp; o.connect(a); a.connect(g); o.start(t); oscs.push(o)};
    if(V.wave==='saw'){mk('sawtooth',f,-5,0.5); mk('sawtooth',f,5,0.5)}
    else if(V.wave==='coro'){mk('sawtooth',f,-12,0.34); mk('sawtooth',f,0,0.34); mk('sawtooth',f,12,0.34)}
    else {mk('square',f,-4,0.45); mk('square',f*1.0,4,0.45)}
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(1,t+0.02); g.connect(G.carrier);
    return {g,oscs,wave:V.wave};
  }
  function stopNote(v){const t=ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value,t); v.g.gain.linearRampToValueAtTime(0,t+0.05); v.oscs.forEach(o=>{try{o.stop(t+0.08)}catch(e){}}); setTimeout(()=>{try{v.g.disconnect()}catch(e){}},200)}
  let lastSig='';
  function sync(force){
    if(!G||!stream)return; const ws=wanted(), sig=ws.join(',')+V.wave+V.oct;
    if(sig===lastSig&&!force)return; lastSig=sig;
    G.voices.forEach((v,m)=>{if(!ws.includes(m)||v.wave!==V.wave){stopNote(v); G.voices.delete(m)}});
    ws.forEach(m=>{if(!G.voices.has(m))G.voices.set(m,startNote(m))});
    $('vocState').textContent=ws.length?('CANTANDO '+ws.length+' NOTA'+(ws.length>1?'S':'')):'ESPERANDO NOTAS · tocá un acorde o una tecla';
    G.carrier.gain.value=0.7/Math.sqrt(Math.max(1,ws.length));
  }
  setInterval(sync,90);

  async function toggle(){
    const b=$('vocOn');
    if(V.on){
      V.on=false; if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null} try{micSrc&&micSrc.disconnect()}catch(e){} micSrc=null;
      if(G){G.voices.forEach(stopNote); G.voices.clear()} lastSig=''; b.textContent='▶ ACTIVAR VOCODER'; b.classList.remove('running'); $('vocState').textContent='APAGADO'; return;
    }
    try{
      ctx=await NS.ensure(); NS.init(); build();
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      micSrc=ctx.createMediaStreamSource(stream); micSrc.connect(G.mic); V.on=true; b.textContent='■ APAGAR VOCODER'; b.classList.add('running'); lastSig=''; sync(true);
      NS.toast('VOCODER ACTIVO · USÁ AURICULARES');
    }catch(e){
      $('vocMsg').textContent='No se pudo abrir el micrófono. Revisá que esté conectado, que sea el elegido en «Audio» y que Windows permita a Niebla Studio usarlo (Configuración › Privacidad › Micrófono).';
      NS.toast('NO SE PUDO ABRIR EL MICRÓFONO');
    }
  }
  $('vocOn').onclick=toggle;
  window.NSVoc={state:V};
})();
