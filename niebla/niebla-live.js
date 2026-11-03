/* NIEBLA LIVE · misma Niebla, reacomodada para tocar en vivo en una pantalla 16:9.
   Se activa con la clase "live" en <html> (programa Niebla Live, o la web con ?live).
   Mueve los bloques existentes (no los copia: siguen funcionando igual) a 4 columnas:
   TOCAR · SONIDO · EFECTOS · RITMO Y CAPAS. Lo de configurar (teclado MIDI, audio, vocoder…) queda abajo. */
(function(){
  'use strict';
  // en la web (no en los programas) hay un botón para cambiar de vista
  if(!window.NIEBLA_ELECTRON&&!/Electron/i.test(navigator.userAgent)){
    const live=document.documentElement.classList.contains('live');
    const b=document.createElement('button'); b.className='lv-switch'; b.type='button';
    b.textContent=live?'Vista normal':'Modo en vivo (16:9)';
    b.title=live?'Volver a la vista de una columna':'Reacomoda todo para tocar en vivo en una pantalla grande';
    b.onclick=()=>{const u=new URL(location.href); if(live)u.searchParams.delete('live'); else u.searchParams.set('live','1'); location.href=u.toString()};
    document.body.appendChild(b);
  }
  if(!document.documentElement.classList.contains('live'))return;
  const app=document.querySelector('.app'); if(!app)return;
  const $=s=>app.querySelector(s);
  const kids=[...app.children];
  // un rótulo h2 y lo que lo sigue hasta el próximo rótulo
  function section(title){
    const i=kids.findIndex(e=>e.tagName==='H2'&&e.textContent.trim().toUpperCase()===title); if(i<0)return [];
    const out=[kids[i]]; for(let k=i+1;k<kids.length&&kids[k].tagName!=='H2';k++)out.push(kids[k]); return out;
  }
  const col=(cls,label)=>{const c=document.createElement('div'); c.className='lv-col '+cls; if(label)c.setAttribute('aria-label',label); return c};
  const grid=document.createElement('div'); grid.className='lv-grid';
  const c1=col('lv-tocar','Tocar'), c2=col('lv-sonido','Sonido'), c3=col('lv-efx','Efectos'), c4=col('lv-ritmo','Ritmo y capas');
  const put=(c,els)=>els.forEach(e=>e&&c.appendChild(e));

  const header=$('header'), screen=$('section.screen'), pads=$('#pads'), row=[...app.children].find(e=>e.classList&&e.classList.contains('row')&&e.querySelector('#stopBtn'));
  put(c1,[header,screen,pads,row]);
  put(c2,section('ATMÓSFERAS').concat(section('TONALIDAD'),section('SONIDO')));
  put(c3,section('MAESTRO').concat(section('FX LOCOS'),section('TEXTURA')));
  put(c4,section('RITMO').concat(section('CAPAS')));
  grid.append(c1,c2,c3,c4);

  // abajo, para configurar antes de tocar: teclado MIDI, sonido del teclado, looper, knobs, audio, vocoder
  const studio=$('#studioMount'); const setup=document.createElement('div'); setup.className='lv-setup';
  const sh=document.createElement('h2'); sh.className='lv-setup-t'; sh.textContent='Preparar antes de tocar';
  const sg=document.createElement('div'); sg.className='lv-setup-grid';
  if(studio){
    // agrupar cada h2 con su bloque en una tarjeta
    let card=null;
    [...studio.children].forEach(el=>{
      if(el.tagName==='H2'||(el.tagName==='DIV'&&el.querySelector(':scope>h2'))){card=document.createElement('div'); card.className='lv-card'; sg.appendChild(card)}
      if(!card){card=document.createElement('div'); card.className='lv-card'; sg.appendChild(card)}
      card.appendChild(el);
    });
    studio.remove();
  }
  setup.append(sh,sg);
  const rest=[...app.children];            // lo que quedó (explicación, pie, grabación)
  app.prepend(grid); app.insertBefore(setup,rest[0]||null);

  // la pantalla del acorde un poco más baja, para que entre todo
  const wave=document.getElementById('wave'); if(wave){wave.style.height='120px'}
  // F11 / doble clic en el nombre: pantalla completa
  const goFull=()=>{try{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}catch(e){}};
  addEventListener('keydown',e=>{if(e.key==='F11'&&!window.NIEBLA_ELECTRON){e.preventDefault(); goFull()}});
  header&&header.addEventListener('dblclick',goFull);
  document.title='Niebla Live';
  dispatchEvent(new Event('resize'));
})();
