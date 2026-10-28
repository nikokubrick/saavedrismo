/* NIEBLA STUDIO · interfaz: knobs redondos, luces del panel */
(function(){
  const $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  /* ---- convierte cada slider "label.k" en un knob redondo (el input sigue ahí, oculto) ---- */
  function enhance(label){
    if(label.dataset.pot)return; const inp=label.querySelector('input[type=range]'); if(!inp)return;
    label.dataset.pot='1'; label.classList.add('pot');
    const knob=document.createElement('div'); knob.className='knob'; knob.tabIndex=0; knob.setAttribute('role','slider');
    knob.setAttribute('aria-label',inp.getAttribute('aria-label')||'Control'); knob.innerHTML='<i class="ticks"></i><i class="dial"></i>';
    label.insertBefore(knob,label.firstChild);
    const def=+inp.value, mi=()=>+inp.min||0, ma=()=>+inp.max||100, stp=()=>+inp.step||1;
    const frac=()=>(+inp.value-mi())/((ma()-mi())||1);
    let shown=null;
    const paint=()=>{const v=inp.value; if(v===shown)return; shown=v; knob.querySelector('.dial').style.transform=`rotate(${-135+270*frac()}deg)`; knob.setAttribute('aria-valuenow',v); knob.setAttribute('aria-valuemin',mi()); knob.setAttribute('aria-valuemax',ma())};
    const set=x=>{x=clamp(x,mi(),ma()); x=Math.round((x-mi())/stp())*stp()+mi(); if(String(x)===inp.value)return; inp.value=x; inp.dispatchEvent(new Event('input',{bubbles:true})); paint()};
    let y0=0,v0=0,drag=false;
    knob.addEventListener('pointerdown',e=>{if(e.button!==0)return; drag=true; y0=e.clientY; v0=+inp.value; knob.setPointerCapture(e.pointerId); knob.classList.add('grab'); e.preventDefault()});
    knob.addEventListener('pointermove',e=>{if(!drag)return; const k=e.shiftKey?0.25:1; set(v0+((y0-e.clientY)/170)*(ma()-mi())*k)});
    const up=()=>{drag=false; knob.classList.remove('grab')}; knob.addEventListener('pointerup',up); knob.addEventListener('pointercancel',up);
    knob.addEventListener('wheel',e=>{e.preventDefault(); set(+inp.value+(e.deltaY<0?1:-1)*Math.max(stp(),(ma()-mi())/60))},{passive:false});
    knob.addEventListener('dblclick',()=>set(def));
    knob.addEventListener('keydown',e=>{const d={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:10,PageDown:-10}[e.key]; if(d){e.preventDefault(); set(+inp.value+d*stp()*(Math.abs(d)>1?Math.max(1,Math.round((ma()-mi())/20/stp())):1))}});
    label.addEventListener('click',e=>{if(e.target===label)e.preventDefault()});
    label._paint=paint; paint();
  }
  const scan=root=>(root||document).querySelectorAll('label.k').forEach(enhance);
  scan();
  new MutationObserver(m=>{m.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1){if(n.matches&&n.matches('label.k'))enhance(n); else scan(n)}}))}).observe(document.body,{childList:true,subtree:true});
  setInterval(()=>document.querySelectorAll('label.pot').forEach(l=>l._paint&&l._paint()),160);

  /* ---- luces del panel ---- */
  const header=document.querySelector('header');
  if(header){
    const leds=document.createElement('div'); leds.className='leds'; leds.setAttribute('aria-hidden','true');
    leds.innerHTML='<div><i id="ledPower"></i><b>AUDIO</b></div><div><i id="ledMidiOk"></i><b>TECLADO</b></div><div><i id="ledMidi" class="amber"></i><b>MIDI</b></div><div><i id="ledRec" class="red"></i><b>REC</b></div>';
    header.appendChild(leds);
    setInterval(()=>{
      const on=window.NS&&window.NS.ctx&&window.NS.ctx.state==='running'; $('ledPower').classList.toggle('on',!!on);
      $('ledRec').classList.toggle('on',!!document.querySelector('#recBtn.recording'));
    },250);
  }
})();
