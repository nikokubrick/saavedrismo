/* NIEBLA STUDIO · teclado MIDI, sonidos de teclado, modo acordes tipo Lirio, bajo, looper, asignación de knobs y dispositivos de audio */
(function(){
  const NS=window.NS, H=window.SVH, $=id=>document.getElementById(id);
  const NOTE_NAMES=['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mtof=m=>440*Math.pow(2,(m-69)/12);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ================= estado ================= */
  const DEFAULT={preset:'grande',mode:'notas',split:60,oct:0,fx:false,dyn:true,bright:70,trem:0,space:30,echo:0,bass:false,ctype:'auto',voicing:0,play:'acorde',strum:45,padHold:false,dev:'all',map:{},inId:'',outId:''};
  let K=Object.assign({},DEFAULT); try{Object.assign(K,JSON.parse(localStorage.getItem('niebla-studio-keys')||'{}'))}catch(e){}
  K.map=K.map||{};
  const save=()=>{try{localStorage.setItem('niebla-studio-keys',JSON.stringify(K))}catch(e){}};

  /* ================= sonidos de teclado ================= */
  const PRE={
    grande: {n:'Piano de cola',  kind:'piano', B:0.00018,roll:1.05,dec:1.0, lp:1.0, det:1.4,hp:0.14,hammer:'bright',rel:0.28,bright:70,trem:0, space:30,echo:0, chorus:0},
    pared:  {n:'Piano de pared', kind:'piano', B:0.00055,roll:0.85,dec:0.55,lp:1.3, det:2.6,hp:0.11,hammer:'bright',rel:0.16,bright:78,trem:0, space:14,echo:0, chorus:0},
    fieltro:{n:'Piano de fieltro',kind:'piano',B:0.00012,roll:2.1, dec:1.7, lp:0.42,det:1.0,hp:0.14,hammer:'soft',  rel:0.7, bright:42,trem:0, space:62,echo:18,chorus:0},
    rhodes: {n:'Rhodes',         kind:'rhodes',rel:0.22,bright:62,trem:34,rate:4.6,space:36,echo:12,chorus:0.25},
    wurli:  {n:'Wurlitzer',      kind:'wurli', rel:0.16,bright:58,trem:42,rate:5.4,space:26,echo:0, chorus:0},
    juno:   {n:'Juno',           kind:'juno',  rel:0.4, bright:66,trem:0, space:34,echo:14,chorus:1},
    fm:     {n:'Campana FM',     kind:'fm',    rel:0.5, bright:66,trem:0, space:48,echo:22,chorus:0.3},
    vibra:  {n:'Vibráfono',      kind:'vibra', rel:0.3, bright:62,trem:52,rate:3.6,space:40,echo:10,chorus:0},
    organo: {n:'Órgano',         kind:'organo',rel:0.09,bright:70,trem:26,rate:6.2,space:30,echo:0, chorus:0.4},
    pad:    {n:'Pad de Niebla',  kind:'pad',   rel:2.2, bright:60,trem:0, space:60,echo:20,chorus:0}
  };
  const CHORDS={ // tecla del ordenador → tipo (la "matriz" de acordes)
    auto:{n:'Auto',iv:null,k:'Q'}, may:{n:'Mayor',iv:[0,4,7],k:'A'}, men:{n:'Menor',iv:[0,3,7],k:'S'}, sus2:{n:'Sus2',iv:[0,2,7],k:'D'}, sus4:{n:'Sus4',iv:[0,5,7],k:'F'},
    s7:{n:'7',iv:[0,4,7,10],k:'G'}, maj7:{n:'Maj7',iv:[0,4,7,11],k:'H'}, m7:{n:'m7',iv:[0,3,7,10],k:'J'}, dim:{n:'Dim',iv:[0,3,6],k:'K'}
  };

  let ctx=null, N=null, KX=null;
  const held=new Map();      // tecla física → {voices:[], bass:v, pad:bool, notes:[]}
  const sustained=new Set(); // voces cuyo noteOff espera al pedal
  let pedal=false, modWheel=0, bendCents=0, polyphony=[];

  window.NS_afterMix=function(c,nodes){
    ctx=c; N=nodes; KX={};
    KX.noise=(()=>{const len=ctx.sampleRate, b=ctx.createBuffer(1,len,ctx.sampleRate), d=b.getChannelData(0); for(let i=0;i<len;i++)d[i]=Math.random()*2-1; return b})();
    KX.bend=ctx.createConstantSource(); KX.bend.offset.value=bendCents; KX.bend.start();
    KX.bus=ctx.createGain();
    // chorus estilo Juno (dos líneas moduladas, una a cada lado)
    KX.tremIn=ctx.createGain(); KX.chDry=ctx.createGain(); KX.chWet=ctx.createGain(); KX.chWet.gain.value=0;
    KX.bus.connect(KX.chDry); KX.chDry.connect(KX.tremIn);
    [[0.0065,0.5,-0.85],[0.0078,0.83,0.85]].forEach(([base,rate,pan])=>{
      const d=ctx.createDelay(0.05); d.delayTime.value=base; const l=ctx.createOscillator(); l.frequency.value=rate; const lg=ctx.createGain(); lg.gain.value=0.0022; l.connect(lg); lg.connect(d.delayTime); l.start();
      const p=ctx.createStereoPanner?ctx.createStereoPanner():ctx.createGain(); if(p.pan)p.pan.value=pan; KX.bus.connect(d); d.connect(p); p.connect(KX.chWet)});
    KX.chWet.connect(KX.tremIn);
    // trémolo / rotor
    KX.tremG=ctx.createGain(); KX.tremIn.connect(KX.tremG);
    KX.lfo=ctx.createOscillator(); KX.lfo.frequency.value=4.6; KX.lfoG=ctx.createGain(); KX.lfoG.gain.value=0; KX.lfo.connect(KX.lfoG); KX.lfoG.connect(KX.tremG.gain); KX.lfo.start();
    KX.out=ctx.createGain(); KX.tremG.connect(KX.out); KX.out.connect(N.ch_keys.in);
    KX.send=ctx.createGain(); KX.out.connect(KX.send); KX.send.connect(N.ch_keys.vIn);
    KX.echo=H.echo(ctx); KX.echoSend=ctx.createGain(); KX.echoSend.gain.value=1; KX.out.connect(KX.echo.in); KX.echo.out.connect(N.ch_keys.in); KX.echo.out.connect(KX.send);
    KX.wur=(()=>{const c2=new Float32Array(2048); for(let i=0;i<2048;i++){const x=i/1023.5-1; c2[i]=Math.tanh(x*2.4)} return c2})();
    applyKeys(true);
    if(K.fx&&window.NSMix)window.NSMix.reroute('keys','bus');
    if(K.outId&&ctx.setSinkId){ctx.setSinkId(K.outId).catch(()=>{})}
  };

  function applyKeys(first){
    if(!KX)return; const P=PRE[K.preset], t=ctx.currentTime, r=(p,v)=>first?p.setValueAtTime(v,t):p.setTargetAtTime(v,t,0.08);
    r(KX.chWet.gain,P.chorus*0.8); r(KX.chDry.gain,1-P.chorus*0.2);
    const depth=K.trem/100*0.9; r(KX.tremG.gain,1-depth/2); r(KX.lfoG.gain,depth/2); r(KX.lfo.frequency,P.rate||4.6);
    r(KX.send.gain,K.space/100*1.1);
    const e=K.echo/100; KX.echo.set(H.dotted8(NS.st.bpm||72),0.25+e*0.5,e*0.65);
  }
  const brightMul=()=>(0.25+K.bright/100*1.5)*(1+modWheel*1.2);

  /* ---- una voz de teclado ---- */
  function startVoice(m,vel,t){
    const P=PRE[K.preset];
    if(P.kind==='pad'){
      const gr=NS.makeGroup([m],NS.st.timbre,0.25+0.5*vel,{attack:0.7,dest:KX.bus});
      return {m,rel:P.rel,gr,oscs:[],stop(){NS.killGroup(gr,P.rel)}};
    }
    const f=mtof(m), vg=ctx.createGain(), lp=ctx.createBiquadFilter(), oscs=[];
    lp.type='lowpass'; lp.Q.value=0.5; vg.connect(lp); lp.connect(KX.bus);
    const mk=(type,freq,det)=>{const o=ctx.createOscillator(); o.type=type; o.frequency.value=freq; if(det)o.detune.value=det; KX.bend.connect(o.detune); oscs.push(o); return o};
    const gn=(v)=>{const g=ctx.createGain(); g.gain.value=v; return g};
    const noiseHit=(freq,q,amp,dur,type)=>{const nb=ctx.createBufferSource(); nb.buffer=KX.noise; const bp=ctx.createBiquadFilter(); bp.type=type||'bandpass'; bp.frequency.value=freq; bp.Q.value=q; const g=ctx.createGain();
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(amp,t+0.002); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); nb.connect(bp); bp.connect(g); g.connect(vg); nb.start(t,Math.random()*0.5); nb.stop(t+dur+0.05)};
    const vk=0.3+0.7*vel;
    let level=0.3, auto=0, cutoff=clamp(f*(3+10*vel)*brightMul(),400,15000);

    if(P.kind==='piano'){
      const nP=Math.max(2,Math.min(16,Math.floor(10000/f))), T0=clamp(6.5*Math.pow(261.6/f,0.7),0.6,14)*P.dec; auto=T0*3.5+1;
      for(let n=1;n<=nP;n++){
        const fn=n*f*Math.sqrt(1+P.B*n*n), a=Math.pow(n,-P.roll)*(0.3+0.7*Math.abs(Math.sin(n*Math.PI*P.hp)))*Math.pow(vk,(n-1)*0.4); if(a<0.004)continue;
        for(let w=0;w<(n<=3?2:1);w++){
          const o=mk('sine',fn,w?P.det:0), g=ctx.createGain(), aa=a*(w?0.55:1);
          g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(aa,t+0.003); g.gain.setTargetAtTime(aa*0.32,t+0.003,0.2); g.gain.setTargetAtTime(0,t+0.9,T0/(1+0.5*(n-1)));
          o.connect(g); g.connect(vg); o.start(t); o.stop(t+auto);
        }
      }
      noiseHit(P.hammer==='soft'?420:1500+vel*3500,0.8,(P.hammer==='soft'?0.9:0.45)*vel,0.03);
      level=0.2*Math.pow(vel,1.2)+0.03; cutoff=clamp((500+vel*7500)*P.lp*brightMul(),300,15000);
    }
    else if(P.kind==='rhodes'){
      auto=9; const car=mk('sine',f), m1=mk('sine',f), g1=ctx.createGain();
      g1.gain.setValueAtTime((1.3+2.2*vel)*f,t); g1.gain.setTargetAtTime((0.35+0.45*vel)*f,t,0.5); m1.connect(g1); g1.connect(car.frequency);
      if(f*14<14000){const m2=mk('sine',f*14), g2=ctx.createGain(); g2.gain.setValueAtTime((0.5+1.6*vel)*f,t); g2.gain.setTargetAtTime(0,t,0.045); m2.connect(g2); g2.connect(car.frequency); m2.start(t); m2.stop(t+auto)}
      const env=ctx.createGain(); env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.002); env.gain.setTargetAtTime(0.55,t+0.002,0.2); env.gain.setTargetAtTime(0,t+0.8,3.6*Math.pow(261/f,0.35));
      car.connect(env); env.connect(vg); car.start(t); car.stop(t+auto); m1.start(t); m1.stop(t+auto);
      noiseHit(280,1.2,0.12*vel,0.05); level=0.3*Math.pow(vel,1.1)+0.04; cutoff=clamp((1500+vel*9000)*brightMul(),400,15000);
    }
    else if(P.kind==='wurli'){
      auto=7; const sum=ctx.createGain(), c0=mk('sine',f), h2=mk('sine',f*2), h3=mk('sine',f*3), m1=mk('sine',f), g1=ctx.createGain(), gh2=gn(0.3+0.25*vel), gh3=gn(0.08+0.12*vel);
      g1.gain.setValueAtTime((0.4+1.0*vel)*f,t); g1.gain.setTargetAtTime(0.2*f,t,0.25); m1.connect(g1); g1.connect(c0.frequency);
      c0.connect(sum); h2.connect(gh2); gh2.connect(sum); h3.connect(gh3); gh3.connect(sum);
      const sh=ctx.createWaveShaper(); sh.curve=KX.wur; const pre=gn(0.9+vel*0.8); sum.connect(pre); pre.connect(sh);
      const env=ctx.createGain(); env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.003); env.gain.setTargetAtTime(0.5,t+0.003,0.1); env.gain.setTargetAtTime(0,t+0.45,1.6*Math.pow(261/f,0.3));
      sh.connect(env); env.connect(vg); [c0,h2,h3,m1].forEach(o=>{o.start(t); o.stop(t+auto)});
      noiseHit(2000,1.5,0.06*vel,0.04); level=0.26*Math.pow(vel,0.9)+0.05; cutoff=clamp((1800+vel*5000)*brightMul(),400,12000);
    }
    else if(P.kind==='juno'){
      const o1=mk('sawtooth',f,-5), o2=mk('square',f,5), o3=mk('square',f/2), mix=ctx.createGain(), f1=ctx.createBiquadFilter(), f2=ctx.createBiquadFilter(), env=ctx.createGain();
      [[o1,0.55],[o2,0.32],[o3,0.38]].forEach(([o,a])=>{const g=gn(a); o.connect(g); g.connect(mix)});
      f1.type='lowpass'; f2.type='lowpass'; f1.Q.value=1.4; f2.Q.value=0.7;
      const c0=clamp(f*(7+9*vel)*brightMul(),600,14000), c1=clamp(f*3.2*brightMul(),350,8000);
      f1.frequency.setValueAtTime(c0,t); f1.frequency.setTargetAtTime(c1,t,0.45); f2.frequency.setValueAtTime(c0,t); f2.frequency.setTargetAtTime(c1,t,0.45);
      mix.connect(f1); f1.connect(f2); f2.connect(env); env.connect(vg);
      env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.012); env.gain.setTargetAtTime(0.78,t+0.012,0.3);
      oscs.forEach(o=>o.start(t)); level=0.24*(0.6+0.4*vel); cutoff=15000; auto=0;
    }
    else if(P.kind==='fm'){
      auto=10; const car=mk('sine',f), md=mk('sine',f*3.5), g1=ctx.createGain(), c2=mk('sine',f*2), env=ctx.createGain();
      g1.gain.setValueAtTime((0.7+2.0*vel)*f,t); g1.gain.setTargetAtTime(0.12*f,t,0.55); md.connect(g1); g1.connect(car.frequency);
      const e2=gn(0.25); car.connect(env); c2.connect(e2); e2.connect(env);
      env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.004); env.gain.setTargetAtTime(0.4,t+0.004,0.3); env.gain.setTargetAtTime(0,t+1,2.6*Math.pow(261/f,0.3));
      env.connect(vg); oscs.forEach(o=>{o.start(t); o.stop(t+auto)}); level=0.28*Math.pow(vel,1.0)+0.04; cutoff=clamp((2500+vel*9000)*brightMul(),500,15000);
    }
    else if(P.kind==='vibra'){
      auto=14; [[1,1,3.8],[3.93,0.28,1.0],[9.4,0.1,0.35]].forEach(([r,a,tau])=>{ if(f*r>14000)return;
        const o=mk('sine',f*r), g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(a,t+0.003); g.gain.setTargetAtTime(0,t+0.004,tau*Math.pow(261/f,0.4));
        o.connect(g); g.connect(vg); o.start(t); o.stop(t+auto)});
      noiseHit(3200,2,0.12*vel,0.025); level=0.34*Math.pow(vel,1.0)+0.05; cutoff=clamp(9000*brightMul(),600,15000);
    }
    else if(P.kind==='organo'){
      const R=[0.5,1.5,1,2,3,4,5,6,8], L=[8,8,8,6,4,3,2,1,1], env=ctx.createGain();
      env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(1,t+0.01);
      R.forEach((r,i)=>{ if(f*r>13000)return; const o=mk('sine',f*r), g=gn(L[i]/8*0.11); o.connect(g); g.connect(env); o.start(t)});
      env.connect(vg); noiseHit(3500,1,0.08,0.012,'highpass'); level=0.6; cutoff=clamp(7000*brightMul(),500,15000); auto=0;
    }
    lp.frequency.value=cutoff; vg.gain.value=level;
    if(!auto&&P.kind!=='organo'&&P.kind!=='juno')auto=8;
    return {m,vg,oscs,rel:P.rel,auto,t0:t};
  }
  function stopVoice(v,time){
    if(!v)return; if(v.stop){v.stop(); return}
    const now=Math.max(ctx.currentTime,time||0);
    v.vg.gain.cancelScheduledValues(now); v.vg.gain.setValueAtTime(v.vg.gain.value,now); v.vg.gain.setTargetAtTime(0,now,Math.max(0.02,v.rel/4));
    v.oscs.forEach(o=>{try{o.stop(now+v.rel+0.15)}catch(e){}});
  }
  function releaseVoice(v){ if(pedal){sustained.add(v)} else stopVoice(v) }

  function bassVoice(m,vel){
    const f=mtof(m), t=ctx.currentTime+0.003, vg=ctx.createGain(), lp=ctx.createBiquadFilter(), oscs=[];
    lp.type='lowpass'; lp.frequency.value=520+vel*500; lp.Q.value=0.8; const o1=ctx.createOscillator(), o2=ctx.createOscillator(), g2=ctx.createGain();
    o1.type='sine'; o1.frequency.value=f; o2.type='sawtooth'; o2.frequency.value=f; g2.gain.value=0.35; o1.connect(vg); o2.connect(g2); g2.connect(lp); lp.connect(vg);
    [o1,o2].forEach(o=>{KX.bend.connect(o.detune); o.start(t); oscs.push(o)});
    vg.gain.setValueAtTime(0,t); vg.gain.linearRampToValueAtTime(0.3*(0.5+0.5*vel),t+0.012); vg.connect(N.ch_bajo.in);
    return {m,vg,oscs,rel:0.3};
  }

  /* ================= acordes tipo Lirio ================= */
  function chordIntervals(pc){
    const T=CHORDS[K.ctype];
    if(T&&T.iv)return T.iv.slice();
    const sc=NS.SCALE[NS.st.mode], rel=(pc-NS.st.key+12)%12, d=sc.indexOf(rel);
    if(d<0)return [0,4,7];
    const third=(sc[(d+2)%7]-rel+12)%12, fifth=(sc[(d+4)%7]-rel+12)%12; return [0,third,fifth];
  }
  function chordMidi(key){
    const pc=key%12, iv=chordIntervals(pc); let arr=iv.map(i=>48+pc+i+12*K.oct), v=K.voicing;
    while(v>0){arr.push(arr.shift()+12); v--}
    while(v<0){arr.unshift(arr.pop()-12); v++}
    return arr.sort((a,b)=>a-b);
  }
  let strumDir=1;
  function playChord(key,vel){
    const notes=chordMidi(key), n=notes.length, base=ctx.currentTime+0.004, rec={voices:[],notes:notes.slice(),bass:null};
    let order=notes.map((m,i)=>({m,i}));
    let delays=notes.map(()=>0), vels=notes.map(()=>vel);
    if(K.play==='strum'){ if(strumDir<0)order.reverse(); strumDir*=-1; delays=order.map((_,j)=>j*K.strum/1000); }
    else if(K.play==='slop'){ delays=notes.map(()=>Math.random()*0.085); vels=notes.map(()=>clamp(vel*(0.82+Math.random()*0.3),0.05,1)); order=order.map(o=>o); }
    else if(K.play==='harp'){ const ext=notes.concat(notes.map(m=>m+12)); order=ext.map((m,i)=>({m,i})); delays=order.map((_,j)=>j*0.075); }
    order.forEach((o,j)=>{ const dl=delays[K.play==='slop'?o.i:j]; const v=vels[K.play==='slop'?o.i:Math.min(o.i,n-1)]??vel;
      rec.voices.push(startVoice(o.m,v,base+dl)) });
    if(K.play==='harp')rec.notes=notes.concat(notes.map(m=>m+12));
    if(K.bass)rec.bass=bassVoice(36+(key%12),vel);
    return rec;
  }

  /* ================= manejo de notas ================= */
  let emitQ=false; const emitChord=()=>{if(emitQ)return; emitQ=true; Promise.resolve().then(()=>{emitQ=false; NS.capaSubs.forEach(f=>{try{f()}catch(e){}})})};
  function heldNotes(){const s=new Set(); held.forEach(h=>{(h.notes||[]).forEach(n=>s.add(n))}); return [...s].sort((a,b)=>a-b)}
  window.NS_chord=function(){
    const ns=heldNotes(); if(!ns.length)return null;
    return {notes:ns,name:ns.slice(0,4).map(n=>NOTE_NAMES[n%12]).join('·')};
  };
  function padFromKey(key){
    const rel=(key%12-NS.st.key+12)%12, sc=NS.SCALE[NS.st.mode], D=NS.DEGREES[NS.st.mode];
    const i=D.findIndex(([deg])=>sc[deg]===rel); if(i<0){return false}
    if(NS.getActive()!==i)NS.press(i); return true;
  }
  let noteOnBusy=false;
  const pend=new Set(), cancelOff=new Set();
  async function noteOn(key,vel01,src){
    if(!(NS.ctx&&NS.ctx.state==='running'&&KX)){
      pend.add(key); try{await NS.ensure()}catch(e){pend.delete(key); return}
      pend.delete(key);
    }
    if(!KX)return;
    const early=cancelOff.delete(key); if(early)setTimeout(()=>noteOff(key,true),90);
    if(held.has(key)){noteOff(key,true)}
    const vel=K.dyn?clamp(Math.pow(vel01,0.8),0.05,1):0.75;
    const asPad=K.mode==='acordes'||(K.mode==='dividido'&&key<K.split);
    if(asPad){ const ok=padFromKey(key); held.set(key,{pad:true,notes:[],ok}); lit.add(key); drawKb(); return }
    if(K.mode==='orchid'){ held.set(key,playChord(key,vel)); }
    else { const m=key+12*K.oct; held.set(key,{voices:[startVoice(m,vel,ctx.currentTime+0.003)],notes:[m]}); }
    lit.add(key); drawKb(); emitChord(); if(src!=='loop')recEvent('on',key,vel01);
  }
  function noteOff(key,silent){
    if(pend.has(key)){cancelOff.add(key); return}
    const h=held.get(key); if(!h){lit.delete(key); drawKb(); return}
    held.delete(key); lit.delete(key);
    if(h.pad){ if(K.padHold&&NS.getActive()>=0&&!silent)NS.release(); drawKb(); return }
    (h.voices||[]).forEach(releaseVoice); if(h.bass)releaseVoice(h.bass);
    drawKb(); emitChord(); if(!silent)recEvent('off',key,0);
  }
  function pedalSet(on){ pedal=on; if(!on){sustained.forEach(v=>stopVoice(v)); sustained.clear()} }
  function allOff(){ [...held.keys()].forEach(k=>noteOff(k,true)); sustained.forEach(v=>stopVoice(v)); sustained.clear(); lit.clear(); drawKb(); emitChord() }

  /* ================= looper de notas ================= */
  const L={state:'idle',events:[],len:0,t0:0,timers:[]};
  function recEvent(type,key,vel){
    if(L.state!=='rec'&&L.state!=='dub')return;
    const now=performance.now(); const t=L.state==='rec'?now-L.t0:((now-L.t0)%L.len);
    L.events.push({t,type,key,vel});
  }
  function loopSchedule(){
    L.timers.forEach(clearTimeout); L.timers=[];
    if(L.state!=='play'&&L.state!=='dub')return;
    const cycleStart=L.t0+Math.floor((performance.now()-L.t0)/L.len)*L.len, nextStart=cycleStart+L.len;
    const evs=L.events.slice().sort((a,b)=>a.t-b.t);
    evs.forEach(e=>{const at=cycleStart+e.t-performance.now(); if(at>=0)L.timers.push(setTimeout(()=>{if(e.type==='on')noteOn(e.key,e.vel,'loop'); else noteOff(e.key,true)},at))});
    L.timers.push(setTimeout(()=>{if(L.state==='play'||L.state==='dub'){loopSchedule()}},nextStart-performance.now()+2));
  }
  function loopBtn(){
    const b=$('lpRec'), p=$('lpPlay'), st=$('lpState');
    if(!b)return;
    b.textContent=L.state==='rec'?'■ CERRAR LOOP':L.state==='dub'?'■ DEJAR DE SUPERPONER':(L.state==='play'?'● SUPERPONER':'● GRABAR LOOP');
    b.classList.toggle('running',L.state==='rec'||L.state==='dub');
    p.textContent=(L.state==='play'||L.state==='dub')?'■ PARAR':'▶ REPRODUCIR'; p.disabled=!L.len;
    st.textContent={idle:'SIN GRABAR',rec:'GRABANDO… tocá y volvé a pulsar para cerrar la vuelta',play:'SONANDO EN BUCLE · '+(L.len/1000).toFixed(1)+' s',dub:'SUPERPONIENDO EN EL BUCLE'}[L.state]||'';
  }
  function loopRecClick(){
    if(L.state==='idle'||(L.state==='stop')){L.events=[]; L.state='rec'; L.t0=performance.now()}
    else if(L.state==='rec'){L.len=Math.max(500,performance.now()-L.t0); L.state='play'; L.t0=performance.now(); loopSchedule()}
    else if(L.state==='play'){L.state='dub'}
    else if(L.state==='dub'){L.state='play'}
    loopBtn();
  }
  function loopPlayClick(){
    if(L.state==='play'||L.state==='dub'){L.state='stop'; L.timers.forEach(clearTimeout); L.timers=[]; allOff()}
    else if(L.len){L.state='play'; L.t0=performance.now(); loopSchedule()}
    loopBtn();
  }
  function loopClear(){L.state='idle'; L.events=[]; L.len=0; L.timers.forEach(clearTimeout); L.timers=[]; allOff(); loopBtn()}

  /* ================= MIDI ================= */
  let access=null, lastShown=0;
  const lit=new Set();
  function setLed(id){const el=$(id); if(!el)return; el.classList.add('on'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'),120)}
  function onMsg(d,inp){
    if(K.dev!=='all'&&inp.id!==K.dev)return;
    const st=d[0]&0xF0; if(d[0]>=0xF8)return;
    setLed('ledMidi');
    const now=performance.now(); if(now-lastShown>60){lastShown=now; const el=$('midiLast'); if(el){el.textContent=describe(d)}}
    if(st===0x90&&d[2]>0){ noteOn(d[1],d[2]/127,'midi'); }
    else if(st===0x80||(st===0x90&&d[2]===0)){ noteOff(d[1]); }
    else if(st===0xB0){ cc(d[1],d[2]); }
    else if(st===0xE0){ const v=((d[2]<<7)|d[1])-8192; bendCents=v/8192*200; if(KX)KX.bend.offset.setTargetAtTime(bendCents,ctx.currentTime,0.01); }
  }
  function describe(d){
    const st=d[0]&0xF0;
    if(st===0x90||st===0x80)return (st===0x90&&d[2]>0?'NOTA ':'SUELTA ')+NOTE_NAMES[d[1]%12]+(Math.floor(d[1]/12)-1)+'  vel '+d[2];
    if(st===0xB0)return 'CC '+d[1]+' = '+d[2]; if(st===0xE0)return 'PITCH BEND '+(((d[2]<<7)|d[1])-8192); return 'MIDI 0x'+d[0].toString(16)+' '+d[1]+' '+d[2];
  }
  function cc(n,v){
    if(learn.active){assignCC(n); return}
    if(n===64){pedalSet(v>=64); return}
    if(n===120||n===123){allOff(); return}
    const key=K.map[n];
    if(key){ const T=resolve(key); if(T)T.set(v/127); return }
    if(n===1){ modWheel=v/127; $('modOut')&&($('modOut').textContent=Math.round(modWheel*100)); }
  }
  async function initMidi(){
    const st=$('midiStatus');
    if(!navigator.requestMIDIAccess){if(st)st.textContent='ESTE ENTORNO NO TIENE MIDI'; return}
    try{access=await navigator.requestMIDIAccess({sysex:false})}catch(e){if(st)st.textContent='PERMISO MIDI DENEGADO'; return}
    access.onstatechange=()=>devices();
    devices();
  }
  function devices(){
    const sel=$('midiDev'); if(!access||!sel)return;
    const ins=[...access.inputs.values()];
    ins.forEach(i=>{i.onmidimessage=e=>onMsg(e.data,i)});
    sel.innerHTML='<option value="all">Todos los teclados conectados</option>'+ins.map(i=>`<option value="${esc(i.id)}">${esc(i.name||'MIDI')}</option>`).join('');
    if(K.dev!=='all'&&!ins.some(i=>i.id===K.dev))K.dev='all';
    sel.value=K.dev;
    const st=$('midiStatus'); if(st){st.textContent=ins.length?('CONECTADO · '+ins.map(i=>i.name).join(' + ')):'SIN TECLADO · conectalo por USB (se detecta solo)'; st.classList.toggle('ok',!!ins.length)}
    const led=$('ledMidiOk'); if(led)led.classList.toggle('on',!!ins.length);
  }

  /* ================= asignación de knobs (MIDI learn) ================= */
  const learn={active:false,queue:[],idx:0,done:new Set()};
  const WIZARD=['r:main:k_fuzz','r:main:k_swirl','r:main:k_metal','r:main:k_bright','r:main:k_space','r:main:k_echo','r:main:k_tape','mix:keys'];
  function resolve(key){
    if(key.startsWith('mix:'))return window.NSMix.targets[key];
    const m=/^r:([^:]+):(.+)$/.exec(key); if(!m)return null;
    const el=m[1]==='main'?document.getElementById(m[2]):document.querySelector(`[data-capa="${m[1]}"] input[data-k="${m[2]}"]`); if(!el)return null;
    return {label:(m[1]==='main'?'':m[1][0].toUpperCase()+m[1].slice(1)+' · ')+(el.getAttribute('aria-label')||m[2]),set(v){
      const mi=+el.min||0, ma=+el.max||100, stp=+el.step||1; let x=mi+v*(ma-mi); x=Math.round((x-mi)/stp)*stp+mi; el.value=x; el.dispatchEvent(new Event('input',{bubbles:true}))}};
  }
  function keyForEl(el){
    if(!el)return null; if(el.id)return 'r:main:'+el.id;
    const c=el.closest('[data-capa]'); return c&&el.dataset.k?('r:'+c.dataset.capa+':'+el.dataset.k):null;
  }
  function bar(msg){const b=$('learnBar'); if(!b)return; b.hidden=!msg; b.querySelector('span').textContent=msg||''}
  function startLearn(keys){
    learn.active=true; learn.queue=keys.slice(); learn.idx=0; learn.done.clear(); nextLearn();
  }
  function nextLearn(){
    if(learn.idx>=learn.queue.length){learn.active=false; bar(''); NS.toast('KNOBS ASIGNADOS'); renderMap(); return}
    const T=resolve(learn.queue[learn.idx]); const lab=T?T.label:learn.queue[learn.idx];
    bar(`MOVÉ UN KNOB O FADER DE TU TECLADO PARA «${lab.toUpperCase()}»`+(learn.queue.length>1?` (${learn.idx+1} de ${learn.queue.length})`:'')+' · ESC CANCELA · ESPACIO SALTA');
  }
  function assignCC(n){
    if(learn.done.has(n))return; // todavía moviendo el knob anterior
    const key=learn.queue[learn.idx];
    Object.keys(K.map).forEach(c=>{if(K.map[c]===key||+c===n)delete K.map[c]});
    K.map[n]=key; learn.done.add(n); save(); learn.idx++; renderMap(); nextLearn();
  }
  function cancelLearn(){learn.active=false; bar(''); renderMap()}
  function renderMap(){
    const box=$('mapList'); if(!box)return; const ks=Object.keys(K.map);
    box.innerHTML=ks.length?ks.map(c=>{const T=resolve(K.map[c]); return `<span class="chip2"><b>CC ${c}</b> → ${esc(T?T.label:K.map[c])} <button data-del="${c}" aria-label="Quitar">×</button></span>`}).join(''):'<span class="hint">Todavía no asignaste ningún knob.</span>';
    box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{delete K.map[b.dataset.del]; save(); renderMap()});
  }
  document.addEventListener('contextmenu',e=>{
    const strip=e.target.closest('.strip'); if(strip){e.preventDefault(); startLearn(['mix:'+strip.dataset.ch]); return}
    const host=e.target.closest('label.k, .pot'); if(!host)return; const inp=host.querySelector('input[type=range]'); const key=keyForEl(inp); if(key){e.preventDefault(); startLearn([key])}
  });
  window.addEventListener('keydown',e=>{
    if(!learn.active)return;
    if(e.key==='Escape'){cancelLearn(); e.preventDefault()} else if(e.code==='Space'){learn.idx++; nextLearn(); e.preventDefault(); e.stopPropagation()}
  },true);

  /* ================= teclado del ordenador: matriz de acordes ================= */
  document.addEventListener('keydown',e=>{
    if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea'))return;
    const t=Object.keys(CHORDS).find(k=>'Key'+CHORDS[k].k===e.code); if(t){setChordType(t)}
  });
  function ctypeUI(){document.querySelectorAll('#ctypes button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===K.ctype))}
  function setChordType(t){K.ctype=t; save(); ctypeUI(); if(K.mode!=='orchid')NS.toast('ACORDE: '+CHORDS[t].n.toUpperCase()+' (activá el modo Acordes tipo Lirio para usarlo)')}

  /* ================= UI ================= */
  const mount=$('studioMount');
  const knobRow=(id,label,min,max,step,val)=>`<label class="k"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}"><output id="o_${id}"></output></label>`;
  mount.innerHTML=`
    <h2 class="lbl">TECLADO MIDI</h2>
    <section class="midi px">
      <div class="midi-top"><span class="chip2 status" id="midiStatus">BUSCANDO TECLADOS…</span><label class="f"><span>ENTRADA MIDI</span><select id="midiDev"><option value="all">Todos los teclados conectados</option></select></label></div>
      <canvas id="kb" aria-label="Teclado en pantalla"></canvas>
      <p class="hint kbnote">Este teclado dibujado es solo un monitor: se enciende con lo que tocás en tu teclado MIDI real. También podés hacer clic para probar sin él.</p>
      <div class="midi-last"><span>ÚLTIMO MENSAJE</span><b id="midiLast">—</b><span>RUEDA MOD</span><b id="modOut">0</b></div>
      <h3 class="sub">QUÉ HACE CADA TECLA</h3>
      <div class="seg term px" id="modeSeg2" role="group" aria-label="Modo del teclado">
        <button data-v="notas">Tocar notas</button><button data-v="acordes">Acordes de Niebla</button><button data-v="dividido">Dividido</button><button data-v="orchid">Acordes tipo Lirio</button>
      </div>
      <p class="hint" id="modeHelp"></p>
      <div id="splitRow" class="splitrow" hidden><label class="f"><span>DIVIDIR EN</span><select id="splitSel"></select></label><button class="btn ghost sm" id="splitLearn">FIJAR CON LA PRÓXIMA TECLA</button></div>
      <div id="orchidBox" hidden>
        <h3 class="sub">TIPO DE ACORDE <small>(o las teclas Q A S D F G H J K del ordenador)</small></h3>
        <div class="matrix px" id="ctypes">${Object.keys(CHORDS).map(k=>`<button data-v="${k}" aria-pressed="false"><b>${CHORDS[k].n}</b><small>${CHORDS[k].k}</small></button>`).join('')}</div>
        <h3 class="sub">CÓMO SUENA EL ACORDE</h3>
        <div class="seg term px" id="playSeg" role="group" aria-label="Interpretación"><button data-v="acorde">Acorde</button><button data-v="strum">Strum</button><button data-v="slop">Slop</button><button data-v="harp">Arpa</button></div>
        <div class="knobs px">${knobRow('kk_voicing','Voicing',-4,4,1,K.voicing)}${knobRow('kk_strum','Strum (ms)',10,140,5,K.strum)}</div>
        <div class="toggles"><button class="toggle" id="tBass" aria-pressed="false">BAJO</button></div>
      </div>
    </section>

    <h2 class="lbl">SONIDO DEL TECLADO</h2>
    <div class="presets" id="keyPresets">${Object.keys(PRE).map(k=>`<button data-p="${k}">${PRE[k].n}</button>`).join('')}</div>
    <div class="knobs px">${knobRow('kk_bright','Brillo',0,100,1,K.bright)}${knobRow('kk_trem','Trémolo',0,100,1,K.trem)}${knobRow('kk_space','Espacio',0,100,1,K.space)}${knobRow('kk_echo','Eco',0,100,1,K.echo)}</div>
    <div class="seg term px" id="octSeg" role="group" aria-label="Octava"><button data-v="-2">−2</button><button data-v="-1">−1</button><button data-v="0">0</button><button data-v="1">+1</button><button data-v="2">+2</button></div>
    <div class="toggles">
      <button class="toggle" id="tFx" aria-pressed="false">PASAR POR FX</button>
      <button class="toggle" id="tDyn" aria-pressed="true">DINÁMICA</button>
      <button class="toggle" id="tHold" aria-pressed="false">APAGAR AL SOLTAR</button>
    </div>
    <p class="hint">«Pasar por FX» manda el teclado por el fuzz, el metal y el remolino de Niebla. «Apagar al soltar» corta el acorde de Niebla cuando soltás la tecla (en los modos con acordes de Niebla).</p>

    <h2 class="lbl">LOOPER DE NOTAS</h2>
    <section class="px looper">
      <div class="row"><button class="btn" id="lpRec">● GRABAR LOOP</button><button class="btn ghost" id="lpPlay" disabled>▶ REPRODUCIR</button><button class="btn ghost sm" id="lpClear">BORRAR</button></div>
      <span class="status" id="lpState">SIN GRABAR</span>
      <p class="hint">Grabá una vuelta tocando en el teclado, cerrala con el mismo botón y queda sonando en bucle. Pulsá otra vez para superponer más notas.</p>
    </section>

    <h2 class="lbl">ASIGNAR KNOBS DE TU TECLADO</h2>
    <section class="px assign">
      <p class="hint">Mové cada knob de tu teclado cuando te lo pida. Los 8 primeros quedan en: Fuzz, Remolino, Metal, Brillo, Espacio, Eco, Cinta y volumen de las teclas. Para asignar cualquier otro control (un knob de las capas o un fader de la mesa), hacé <b>clic derecho</b> sobre él y mové un knob.</p>
      <div class="row"><button class="btn" id="wiz">ASISTENTE DE KNOBS (FX LOCOS)</button><button class="btn ghost sm" id="wizClear">BORRAR TODO</button></div>
      <div class="maplist" id="mapList"></div>
    </section>

    <h2 class="lbl">AUDIO · MICRÓFONO E INTERFAZ</h2>
    <section class="px audio">
      <div class="two">
        <label class="f"><span>ENTRADA (MICRÓFONO / INTERFAZ)</span><select id="inSel"><option value="">Predeterminada del sistema</option></select></label>
        <label class="f"><span>SALIDA (ALTAVOCES / AURICULARES)</span><select id="outSel"><option value="">Predeterminada del sistema</option></select></label>
      </div>
      <div class="row"><button class="btn ghost sm" id="devScan">DETECTAR DISPOSITIVOS</button><button class="toggle" id="tLive" aria-pressed="false">ENTRADA EN VIVO</button></div>
      <p class="hint" id="audioMsg">La entrada que elijas la usa el Congelador para grabar y también la «Entrada en vivo», que pasa tu micrófono o instrumento por los FX de Niebla. Usá auriculares para evitar acoples. Si tu interfaz tiene más de una entrada, elegila aquí.</p>
    </section>`;

  const fmt={voicing:v=>(v>0?'+':'')+v,strum:v=>v+' ms',bright:v=>v,trem:v=>v,space:v=>v,echo:v=>v};
  const bindK=(id,key)=>{const el=$('kk_'+id), out=$('o_kk_'+id); const upd=()=>{out.textContent=fmt[id](+el.value)}; el.value=K[key||id]; upd();
    el.addEventListener('input',()=>{K[key||id]=+el.value; upd(); save(); applyKeys()})};
  ['voicing','strum','bright','trem','space','echo'].forEach(id=>bindK(id));
  function seg(id,key,cb,num){const bs=document.querySelectorAll('#'+id+' button'); const u=()=>bs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v)===String(K[key])));
    bs.forEach(b=>b.onclick=()=>{K[key]=num?+b.dataset.v:b.dataset.v; save(); u(); cb&&cb()}); u(); return u}
  const HELP={
    notas:'Cada tecla toca una nota con el sonido elegido. Si dejás un acorde sonando en Niebla, el Engranaje sigue lo que estés tocando.',
    acordes:'Cada tecla dispara el acorde de Niebla que tiene esa nota como raíz (solo las notas de la tonalidad). Pulsá la misma tecla de nuevo y el acorde sigue; con «Apagar al soltar» se corta al soltarla.',
    dividido:'Las teclas por debajo del punto de división disparan los acordes de Niebla; las de arriba tocan notas. Mano izquierda = acordes, mano derecha = melodía.',
    orchid:'Cada tecla es la raíz de un acorde completo del tipo que elijas abajo (en cualquier nota, sin importar la tonalidad). Con el voicing lo abrís o lo invertís.'
  };
  const updMode=seg('modeSeg2','mode',()=>{showMode(); if(K.mode!=='notas')allOff()});
  function showMode(){ $('modeHelp').textContent=HELP[K.mode]; $('splitRow').hidden=K.mode!=='dividido'; $('orchidBox').hidden=K.mode!=='orchid' }
  showMode();
  for(let m=36;m<=84;m++){const o=document.createElement('option'); o.value=m; o.textContent=NOTE_NAMES[m%12]+(Math.floor(m/12)-1)+(m===60?' (Do central)':''); $('splitSel').appendChild(o)}
  $('splitSel').value=K.split; $('splitSel').onchange=e=>{K.split=+e.target.value; save()};
  let splitArm=false; $('splitLearn').onclick=()=>{splitArm=true; NS.toast('TOCÁ LA TECLA DONDE QUERÉS DIVIDIR')};
  document.querySelectorAll('#ctypes button').forEach(b=>b.onclick=()=>setChordType(b.dataset.v)); ctypeUI();
  seg('playSeg','play');
  seg('octSeg','oct',null,true);
  $('tBass').setAttribute('aria-pressed',K.bass); $('tBass').onclick=()=>{K.bass=!K.bass; save(); $('tBass').setAttribute('aria-pressed',K.bass)};
  const tg=(id,key,cb)=>{const b=$(id); b.setAttribute('aria-pressed',K[key]); b.onclick=()=>{K[key]=!K[key]; save(); b.setAttribute('aria-pressed',K[key]); cb&&cb()}};
  tg('tFx','fx',()=>{if(window.NSMix&&NS.ctx)window.NSMix.reroute('keys',K.fx?'bus':'master')}); tg('tDyn','dyn'); tg('tHold','padHold');

  function presetUI(){document.querySelectorAll('#keyPresets button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.p===K.preset))}
  document.querySelectorAll('#keyPresets button').forEach(b=>b.onclick=()=>{
    const P=PRE[b.dataset.p]; allOff(); K.preset=b.dataset.p; K.bright=P.bright; K.trem=P.trem; K.space=P.space; K.echo=P.echo; save();
    ['bright','trem','space','echo'].forEach(id=>{$('kk_'+id).value=K[id]; $('o_kk_'+id).textContent=K[id]});
    presetUI(); applyKeys(); if(NS.ctx)NS.init(); NS.toast(P.n.toUpperCase());
  });
  presetUI();

  $('midiDev').onchange=e=>{K.dev=e.target.value; save()};
  $('lpRec').onclick=loopRecClick; $('lpPlay').onclick=loopPlayClick; $('lpClear').onclick=loopClear; loopBtn();
  $('wiz').onclick=()=>startLearn(WIZARD);
  $('wizClear').onclick=()=>{K.map={}; save(); renderMap()};
  renderMap();
  const lb=document.createElement('div'); lb.id='learnBar'; lb.hidden=true; lb.innerHTML='<span></span><button id="learnX">CANCELAR</button>'; document.body.appendChild(lb); $('learnX').onclick=cancelLearn;

  /* ---- teclado en pantalla ---- */
  const kb=$('kb'), kg=kb.getContext('2d'), LO=36, HI=96;
  const isBlack=m=>[1,3,6,8,10].includes(m%12);
  let whites=[]; for(let m=LO;m<=HI;m++)if(!isBlack(m))whites.push(m);
  function drawKb(){
    const w=kb.clientWidth||600, h=kb.clientHeight||90, dpr=window.devicePixelRatio||1;
    if(kb.width!==Math.round(w*dpr)){kb.width=Math.round(w*dpr); kb.height=Math.round(h*dpr)}
    kg.setTransform(dpr,0,0,dpr,0,0); kg.clearRect(0,0,w,h);
    const kw=w/whites.length, on=m=>lit.has(m)||m===clickNote;
    whites.forEach((m,i)=>{kg.fillStyle=on(m)?'#ff7a1a':'#efe6cf'; kg.fillRect(i*kw+1,0,kw-2,h-2); kg.fillStyle='#00000030'; kg.fillRect(i*kw+kw-2,0,1,h)});
    for(let m=LO;m<=HI;m++)if(isBlack(m)){const i=whites.indexOf(m-1); const x=(i+1)*kw-kw*0.3; kg.fillStyle=on(m)?'#ff9a4a':'#15161a'; kg.fillRect(x,0,kw*0.6,h*0.6)}
    if(K.mode==='dividido'){const i=whites.findIndex(m=>m>=K.split); if(i>=0){kg.fillStyle='#ff4a3a'; kg.fillRect(i*kw-1,0,2,h)}}
  }
  let clickNote=null;
  const noteAt=e=>{const r=kb.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, kw=r.width/whites.length;
    if(y<r.height*0.6){for(let m=LO;m<=HI;m++)if(isBlack(m)){const i=whites.indexOf(m-1), bx=(i+1)*kw-kw*0.3; if(x>=bx&&x<=bx+kw*0.6)return m}}
    return whites[clamp(Math.floor(x/kw),0,whites.length-1)]};
  kb.addEventListener('pointerdown',e=>{kb.setPointerCapture(e.pointerId); const m=noteAt(e); if(clickNote!=null)noteOff(clickNote); clickNote=m; noteOn(m,0.75,'click'); e.preventDefault()});
  kb.addEventListener('pointermove',e=>{if(clickNote==null||!(e.buttons&1))return; const m=noteAt(e); if(m!==clickNote){noteOff(clickNote); clickNote=m; noteOn(m,0.75,'click')}});
  const kbUp=()=>{if(clickNote!=null){noteOff(clickNote); clickNote=null; drawKb()}}; kb.addEventListener('pointerup',kbUp); kb.addEventListener('pointercancel',kbUp);
  window.addEventListener('resize',drawKb); setTimeout(drawKb,50);

  /* ================= dispositivos de audio ================= */
  const gum0=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia?navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices):null;
  if(gum0){
    navigator.mediaDevices.getUserMedia=function(c){
      if(c&&c.audio&&K.inId){const a=c.audio===true?{}:Object.assign({},c.audio); a.deviceId={exact:K.inId};
        return gum0(Object.assign({},c,{audio:a})).catch(err=>{ if(err&&err.name==='OverconstrainedError'){K.inId=''; save(); return gum0(c)} throw err })}
      return gum0(c);
    };
  }
  async function scanDevices(askPermission){
    if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return;
    if(askPermission&&gum0){try{const s=await gum0({audio:true}); s.getTracks().forEach(t=>t.stop())}catch(e){$('audioMsg').textContent='No se pudo acceder al micrófono: revisá que esté conectado y que Windows permita a esta aplicación usarlo (Configuración › Privacidad › Micrófono).'}}
    let list=[]; try{list=await navigator.mediaDevices.enumerateDevices()}catch(e){}
    const fill=(id,kind,cur,label)=>{const sel=$(id); const items=list.filter(d=>d.kind===kind&&d.deviceId!=='default'&&d.deviceId!=='communications');
      sel.innerHTML=`<option value="">Predeterminada del sistema</option>`+items.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||(label+' '+(i+1)))}</option>`).join('');
      sel.value=items.some(d=>d.deviceId===cur)?cur:''};
    fill('inSel','audioinput',K.inId,'Entrada'); fill('outSel','audiooutput',K.outId,'Salida');
  }
  $('devScan').onclick=()=>scanDevices(true);
  $('inSel').onchange=e=>{K.inId=e.target.value; save(); if(live)toggleLive(true)};
  $('outSel').onchange=e=>{K.outId=e.target.value; save(); if(NS.ctx&&NS.ctx.setSinkId)NS.ctx.setSinkId(K.outId||'').then(()=>NS.toast('SALIDA CAMBIADA')).catch(()=>NS.toast('NO SE PUDO CAMBIAR LA SALIDA'))};
  if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener('devicechange',()=>scanDevices(false));
  let live=null;
  async function toggleLive(restart){
    if(live){live.stream.getTracks().forEach(t=>t.stop()); try{live.src.disconnect()}catch(e){} live=null; $('tLive').setAttribute('aria-pressed',false); if(!restart)return}
    try{ await NS.ensure(); NS.init();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const src=NS.ctx.createMediaStreamSource(stream); src.connect(N.ch_entrada.in); live={stream,src}; $('tLive').setAttribute('aria-pressed',true); scanDevices(false);
      NS.toast('ENTRADA EN VIVO ACTIVA · USÁ AURICULARES');
    }catch(e){NS.toast('NO SE PUDO ABRIR LA ENTRADA')}
  }
  $('tLive').onclick=()=>toggleLive(false);

  /* teclas de dividir */
  window.NSKeys={noteOn,noteOff,allOff,heldNotes,state:K,presets:PRE};
  // "fijar con la próxima tecla": se intercepta aquí
  initMidi(); scanDevices(false);
  window.addEventListener('beforeunload',()=>{try{allOff()}catch(e){}});
  // atajo: si hay que fijar el punto de división, la próxima tecla MIDI lo fija
  const origNoteOn=noteOn;
  noteOn=async function(key,v,s){ if(splitArm){splitArm=false; K.split=key; $('splitSel').value=key; save(); drawKb(); NS.toast('DIVIDIDO EN '+NOTE_NAMES[key%12]+(Math.floor(key/12)-1)); return} return origNoteOn(key,v,s) };
})();
