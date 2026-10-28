/* NIEBLA STUDIO · grabación de la mezcla completa en WAV de 24 bits (sin pérdida), lista para tu DAW */
(function(){
  const NS=window.NS, $=id=>document.getElementById(id);
  const btn=$('recBtn'); if(!btn)return;
  let rec=null, chunks=[], t0=0, url='', frames=0, proc=null, sink=null;

  function encodeWav(chL,chR,rate,bits){
    const n=chL.reduce((a,c)=>a+c.length,0), bps=bits/8, data=n*2*bps, buf=new ArrayBuffer(44+data), dv=new DataView(buf);
    const wr=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))};
    wr(0,'RIFF'); dv.setUint32(4,36+data,true); wr(8,'WAVE'); wr(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,2,true);
    dv.setUint32(24,rate,true); dv.setUint32(28,rate*2*bps,true); dv.setUint16(32,2*bps,true); dv.setUint16(34,bits,true); wr(36,'data'); dv.setUint32(40,data,true);
    let o=44;
    for(let c=0;c<chL.length;c++){
      const L=chL[c], R=chR[c];
      for(let i=0;i<L.length;i++){
        for(const x0 of [L[i],R[i]]){
          const x=Math.max(-1,Math.min(1,x0)), v=Math.round(x<0?x*8388608:x*8388607);
          dv.setUint8(o,v&255); dv.setUint8(o+1,(v>>8)&255); dv.setUint8(o+2,(v>>16)&255); o+=3;
        }
      }
    }
    return new Blob([buf],{type:'audio/wav'});
  }
  function start(){
    const ctx=NS.ctx, src=NS.nodes.out; chunks=[]; frames=0; t0=Date.now();
    proc=ctx.createScriptProcessor(4096,2,2); sink=ctx.createGain(); sink.gain.value=0;
    proc.onaudioprocess=e=>{const l=e.inputBuffer.getChannelData(0), r=e.inputBuffer.numberOfChannels>1?e.inputBuffer.getChannelData(1):l; chunks.push([new Float32Array(l),new Float32Array(r)]); frames+=l.length};
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination); rec=true;
    btn.textContent='■ PARAR GRABACIÓN'; btn.classList.add('recording');
    const s=$('status'); s.className='status rec'; s.textContent='● GRABANDO WAV 24 BITS';
  }
  function stop(){
    const ctx=NS.ctx; rec=false; try{NS.nodes.out.disconnect(proc)}catch(e){} try{proc.disconnect(); sink.disconnect()}catch(e){} proc.onaudioprocess=null;
    const blob=encodeWav(chunks.map(c=>c[0]),chunks.map(c=>c[1]),ctx.sampleRate,24); chunks=[];
    if(url)URL.revokeObjectURL(url); url=URL.createObjectURL(blob);
    $('recAudio').src=url; $('recDl').href=url; $('recDl').download='niebla-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.wav';
    const secs=Math.round(frames/ctx.sampleRate); $('recInfo').textContent=`${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')} · WAV estéreo 24 bits · ${ctx.sampleRate/1000} kHz · ${(blob.size/1048576).toFixed(1)} MB`;
    $('recDl').textContent='GUARDAR WAV'; $('recBox').hidden=false; btn.textContent='● GRABAR'; btn.classList.remove('recording');
    const s=$('status'); s.className='status'; s.textContent='GRABACIÓN LISTA ABAJO · GUARDAR WAV';
    $('recBox').scrollIntoView({behavior:'smooth',block:'nearest'});
    window.NSRecLast=blob;
  }
  btn.addEventListener('click',async e=>{
    e.stopImmediatePropagation(); e.preventDefault();
    try{await NS.ensure()}catch(err){NS.toast('ESTE ENTORNO NO PUDO INICIAR EL AUDIO'); return}
    if(rec)stop(); else{start(); if(NS.getActive()<0)NS.toast('GRABANDO: TOCÁ ALGO')}
  },true);
})();
