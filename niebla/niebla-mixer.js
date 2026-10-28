/* NIEBLA STUDIO · mesa de mezcla: un canal por cada parte, mute/solo, medidores y asignación MIDI */
(function(){
  const $=id=>document.getElementById(id);
  const CHANNELS=[
    {id:'pads',  label:'ACORDES',  dest:'bus'},
    {id:'drone', label:'DRONE',    dest:'bus'},
    {id:'shim',  label:'BRILLO',   dest:'shimBus'},
    {id:'keys',  label:'TECLAS',   dest:'master', verb:true},
    {id:'bajo',  label:'BAJO',     dest:'master'},
    {id:'ritmo', label:'RITMO',    dest:'master', verb:true},
    {id:'arco',  label:'ARCO',     dest:'master', verb:true},
    {id:'polilla',label:'POLILLA', dest:'master', verb:true},
    {id:'engranaje',label:'ENGRAN.',dest:'master', verb:true},
    {id:'congelador',label:'CONGEL.',dest:'master', verb:true},
    {id:'vocoder',label:'VOCODER',  dest:'master', verb:true},
    {id:'entrada',label:'ENTRADA', dest:'bus'}
  ];
  const DEF=0.8; // 0.8 = ganancia 1 (0 dB)
  const level=v=>v<=0.001?0:Math.pow(v/DEF,2);
  const dbOf=g=>g<=0.0001?'-∞':(20*Math.log10(g)).toFixed(1);
  let saved={}; try{saved=JSON.parse(localStorage.getItem('niebla-studio-mix')||'{}')||{}}catch(e){}
  const state={}; CHANNELS.concat([{id:'master'}]).forEach(c=>{const s=saved[c.id]||{}; state[c.id]={v:typeof s.v==='number'?s.v:DEF,m:!!s.m,s:!!s.s}});
  const save=()=>{try{localStorage.setItem('niebla-studio-mix',JSON.stringify(state))}catch(e){}};
  let ctx=null, N=null; const chn={}; let master=null;
  window.NSMix={state,CHANNELS,setLevel,getLevel:id=>state[id].v,targets:{}};

  function anySolo(){return CHANNELS.some(c=>state[c.id].s)}
  function eff(id){const s=state[id]; if(s.m)return 0; if(id!=='master'&&anySolo()&&!s.s)return 0; return level(s.v)}
  function apply(){
    if(!ctx)return; const t=ctx.currentTime;
    CHANNELS.forEach(c=>{const ch=chn[c.id]; if(!ch)return; const g=eff(c.id); ch.in.gain.setTargetAtTime(g,t,0.03); if(ch.vIn)ch.vIn.gain.setTargetAtTime(g,t,0.03)});
    if(master)master.gain.setTargetAtTime(eff('master'),t,0.03);
  }

  /* Se llama desde Niebla cuando se crea el audio */
  window.NS_onInit=function(c,nodes){
    ctx=c; N=nodes;
    CHANNELS.forEach(def=>{
      const ch={in:ctx.createGain(), an:ctx.createAnalyser()}; ch.an.fftSize=512; ch.an.smoothingTimeConstant=0;
      ch.in.connect(ch.an);
      if(def.dest==='bus')ch.in.connect(N.bus); else if(def.dest==='shimBus')ch.in.connect(N.shimBus); else ch.in.connect(N.master);
      if(def.verb){ch.vIn=ctx.createGain(); ch.vIn.connect(N.verb)}
      chn[def.id]=ch; N['ch_'+def.id]=ch;
    });
    master=N.out; N.chMaster={an:N.an};
    apply();
    if(window.NS_afterMix)window.NS_afterMix(ctx,N);
  };
  window.NSMix.reroute=function(id,destName){ // TECLAS puede ir directo o por los FX de Niebla
    const ch=chn[id]; if(!ch)return; try{ch.in.disconnect()}catch(e){}
    ch.in.connect(ch.an); ch.in.connect(destName==='bus'?N.bus:N.master);
  };

  function setLevel(id,v,fromUI){
    state[id].v=Math.max(0,Math.min(1,v)); save(); apply(); paint(id);
  }

  /* ---- UI ---- */
  const dock=document.createElement('aside'); dock.id='mixer'; dock.setAttribute('aria-label','Mesa de mezcla');
  const ids=CHANNELS.map(c=>c.id).concat(['master']);
  const labelOf=id=>id==='master'?'MASTER':CHANNELS.find(c=>c.id===id).label;
  dock.innerHTML=`<div class="mx-head"><b>MESA DE MEZCLA</b><span class="mx-hint">arrastrá los faders · doble clic = 0 dB · clic derecho = asignar a un knob MIDI</span><button class="mx-toggle" id="mxToggle" aria-expanded="true">▼ OCULTAR</button></div>
  <div class="mx-strips">${ids.map(id=>`
    <div class="strip${id==='master'?' master':''}" data-ch="${id}">
      <div class="mx-lcd"><span class="db">0.0</span></div>
      <div class="mx-body">
        <div class="vu" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
        <div class="fader" tabindex="0" role="slider" aria-label="Volumen ${labelOf(id)}" aria-valuemin="0" aria-valuemax="100"><div class="slot"></div><div class="cap"></div></div>
        <div class="scale" aria-hidden="true"><span>+4</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-∞</span></div>
      </div>
      <div class="mx-sw">${id==='master'?'':'<button class="s" aria-pressed="false" title="Solo">S</button>'}<button class="m" aria-pressed="false" title="Silenciar">M</button></div>
      <div class="mx-name">${labelOf(id)}</div>
    </div>`).join('')}</div>`;
  document.body.appendChild(dock);
  document.body.classList.add('has-mixer');
  $('mxToggle').onclick=()=>{const c=dock.classList.toggle('closed'); $('mxToggle').textContent=c?'▲ MOSTRAR':'▼ OCULTAR'; $('mxToggle').setAttribute('aria-expanded',!c); document.body.classList.toggle('mixer-closed',c)};
  if(window.innerWidth<760)$('mxToggle').click(); // en el celular arranca oculta para no tapar los controles

  const strip=id=>dock.querySelector(`.strip[data-ch="${id}"]`);
  function paint(id){
    const el=strip(id), s=state[id]; if(!el)return;
    const cap=el.querySelector('.cap'); cap.style.bottom='calc(10px + (100% - 20px) * '+s.v+')';
    const g=level(s.v); el.querySelector('.db').textContent=dbOf(g)+(g>0.0001?'':'');
    el.querySelector('.fader').setAttribute('aria-valuenow',Math.round(s.v*100));
    const m=el.querySelector('.m'), so=el.querySelector('.s'); m.setAttribute('aria-pressed',s.m); if(so)so.setAttribute('aria-pressed',s.s);
    el.classList.toggle('muted',s.m);
  }
  ids.forEach(id=>{
    const el=strip(id), f=el.querySelector('.fader');
    const fromY=e=>{const r=f.querySelector('.slot').getBoundingClientRect(); return 1-(e.clientY-r.top)/r.height};
    let drag=false;
    f.addEventListener('pointerdown',e=>{if(e.button!==0)return; drag=true; f.setPointerCapture(e.pointerId); setLevel(id,fromY(e)); e.preventDefault()});
    f.addEventListener('pointermove',e=>{if(drag)setLevel(id,fromY(e))});
    f.addEventListener('pointerup',()=>{drag=false}); f.addEventListener('pointercancel',()=>{drag=false});
    f.addEventListener('dblclick',()=>setLevel(id,DEF));
    f.addEventListener('wheel',e=>{e.preventDefault(); setLevel(id,state[id].v+(e.deltaY<0?0.02:-0.02))},{passive:false});
    f.addEventListener('keydown',e=>{const k={ArrowUp:.02,ArrowRight:.02,ArrowDown:-.02,ArrowLeft:-.02,PageUp:.1,PageDown:-.1}[e.key]; if(k){e.preventDefault(); setLevel(id,state[id].v+k)} else if(e.key==='Home'){setLevel(id,1)} else if(e.key==='End'){setLevel(id,0)}});
    el.querySelector('.m').onclick=()=>{state[id].m=!state[id].m; save(); apply(); paint(id)};
    const so=el.querySelector('.s'); if(so)so.onclick=()=>{state[id].s=!state[id].s; save(); apply(); ids.forEach(paint)};
    window.NSMix.targets['mix:'+id]={label:'Fader '+labelOf(id),set:v=>setLevel(id,v)};
    paint(id);
  });

  /* medidores */
  const vus={}; ids.forEach(id=>{vus[id]=[...strip(id).querySelectorAll('.vu i')]});
  const buf=new Float32Array(512), hold={}; ids.forEach(id=>hold[id]=0);
  function meter(){
    if(ctx){
      ids.forEach(id=>{
        const an=id==='master'?(N.an):(chn[id]&&chn[id].an); if(!an)return;
        const b=an.fftSize===buf.length?buf:new Float32Array(an.fftSize); an.getFloatTimeDomainData(b);
        let pk=0; for(let i=0;i<b.length;i++){const a=Math.abs(b[i]); if(a>pk)pk=a}
        const db=pk>0.00003?20*Math.log10(pk):-90; const v=Math.max(0,Math.min(1,(db+54)/54)); // -54..0 dB
        hold[id]=Math.max(v,hold[id]-0.025);
        const n=Math.round(hold[id]*14), L=vus[id];
        for(let i=0;i<14;i++){L[i].className=i<n?(i>=12?'on r':i>=9?'on y':'on g'):''}
      });
    }
    requestAnimationFrame(meter);
  }
  requestAnimationFrame(meter);
})();
