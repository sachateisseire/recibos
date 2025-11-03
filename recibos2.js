// ==UserScript==
// @name         Descargar recibos GCBA (v4.1 - nuevos colores iOS)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Estilo iOS con colores personalizados y slide horizontal desde la derecha.
// @match        https://badesdeadentro.gob.ar/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
  
    const DELAY_CLICK = 2500;
    const WAIT_AFTER_LOAD = 4000;
    const WAIT_BETWEEN_PERIODS = 3500;
    const FADE_TIME = 250;
    const SLIDE_DISTANCE = 40;
    const STAGGER_DELAY = 100;
  
    const STATE_KEY_AUTO = 'gcbaRecibosAuto_v4';
    const STATE_KEY_RANGE = 'gcbaRecibosRange_v4';
  
    const MONTHS = [
      ['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],
      ['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']
    ];
  
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
  
    function getCurrentYear() {
      const url = new URL(location.href);
      return parseInt(url.searchParams.get('anio')||'');
    }
    function setYearInURL(anio) {
      const url = new URL(location.href);
      url.searchParams.set('anio',String(anio));
      location.href = url.toString();
    }
    async function waitForDownloadButtons(maxMs=15000){
      const start=Date.now();
      while(Date.now()-start<maxMs){
        const n=document.querySelectorAll('button.descargar-recibo').length;
        if(n>0)return true;
        await sleep(300);
      }return false;
    }
  
    async function downloadVisible({confirmPrompt=true,minMonth=null,maxMonth=null}={}) {
      let botones=[...document.querySelectorAll('button.descargar-recibo')];
      if(!botones.length)return 0;
      botones=botones.toReversed();
      if(minMonth||maxMonth){
        botones=botones.filter(btn=>{
          const url=btn.dataset.url||'';
          const m=url.match(/periodo=(\d{4})-(\d{2})/);
          if(!m)return true;
          const mes=parseInt(m[2]);
          if(minMonth&&mes<parseInt(minMonth))return false;
          if(maxMonth&&mes>parseInt(maxMonth))return false;
          return true;
        });
      }
      if(!botones.length)return 0;
      if(confirmPrompt&&!confirm(`Descargar ${botones.length} recibos visibles?`))return 0;
      let ex=0;
      for(let i=0;i<botones.length;i++){
        try{botones[i].click();ex++;}catch{}
        await sleep(DELAY_CLICK+1000);
      }return ex;
    }
  
    async function descargarVisiblesConConfirm(){
      if(!await waitForDownloadButtons()){alert('⚠️ No se encontraron recibos visibles.');return;}
      const n=await downloadVisible({confirmPrompt:true});
      if(n>0)alert(`✅ Se lanzaron ${n} descargas.`);
    }
  
    async function runAutoCycleStep(){
      await sleep(WAIT_AFTER_LOAD);
      const anio=getCurrentYear(),st=getState(STATE_KEY_AUTO),end=Number(st?.end??2025);
      if(await waitForDownloadButtons())await downloadVisible({confirmPrompt:false});
      if(anio<end){
        const next=anio+1;
        localStorage.setItem(STATE_KEY_AUTO,JSON.stringify({active:true,next}));
        await sleep(WAIT_BETWEEN_PERIODS);setYearInURL(next);
      }else{localStorage.removeItem(STATE_KEY_AUTO);alert(`✅ Completado hasta ${end}.`);}
    }
    function startAutoCycle(){
      alert('🔁 Iniciando ciclo 2017→2025...');
      localStorage.setItem(STATE_KEY_AUTO,JSON.stringify({active:true,start:2017,end:2025}));
      setYearInURL(2017);
    }
  
    async function runRangeCycleStep(){
      await sleep(WAIT_AFTER_LOAD);
      const y=getCurrentYear(),st=getState(STATE_KEY_RANGE);
      if(!st?.active)return;
      const {startY,startM,endY,endM}=st;
      if(!await waitForDownloadButtons())return;
      if(y===startY&&y===endY){
        await downloadVisible({confirmPrompt:false,minMonth:startM,maxMonth:endM});
        localStorage.removeItem(STATE_KEY_RANGE);
        alert(`✅ Descarga completada hasta ${endY}-${String(endM).padStart(2,'0')}`);return;
      }
      if(y===startY)await downloadVisible({confirmPrompt:false,minMonth:startM});
      else if(y===endY){await downloadVisible({confirmPrompt:false,maxMonth:endM});
        localStorage.removeItem(STATE_KEY_RANGE);
        alert(`✅ Descarga completada hasta ${endY}-${String(endM).padStart(2,'0')}`);return;}
      else await downloadVisible({confirmPrompt:false});
      if(y<endY){
        const next=y+1;
        localStorage.setItem(STATE_KEY_RANGE,JSON.stringify({...st,nextY:next}));
        await sleep(WAIT_BETWEEN_PERIODS+2000);
        setYearInURL(next);
      }else localStorage.removeItem(STATE_KEY_RANGE);
    }
  
    function startRangeCycle(aY,aM,zY,zM){
      alert(`📅 Descarga desde ${aY}-${aM} hasta ${zY}-${zM}`);
      localStorage.setItem(STATE_KEY_RANGE,JSON.stringify({active:true,startY:aY,startM:aM,endY:zY,endM:zM,nextY:aY}));
      setYearInURL(aY);
    }
  
    function getState(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}}
    (async()=>{
      const s=getState(STATE_KEY_RANGE),y=getCurrentYear();
      if(s?.active){const n=Number(s.nextY??s.startY);
        if(y===n||y===Number(s.startY))await runRangeCycleStep();}
    })();
  
    // ===== Animaciones =====
    const fadeSlideIn=(el,d=0)=>{el.style.opacity='0';el.style.transform=`translateX(${SLIDE_DISTANCE}px)`;el.style.display='block';
      el.style.transition=`opacity ${FADE_TIME}ms ease, transform ${FADE_TIME}ms ease`;
      setTimeout(()=>{el.style.opacity='1';el.style.transform='translateX(0)';},d);
    };
    const fadeSlideOut=(el,d=0)=>{setTimeout(()=>{
      el.style.opacity='0';el.style.transform=`translateX(${SLIDE_DISTANCE}px)`;setTimeout(()=>el.style.display='none',FADE_TIME);
    },d);};
    const fadeOutAndRemove=el=>{el.style.opacity='0';setTimeout(()=>el.remove(),FADE_TIME);};
  
    // ===== Botones =====
    function createButtons(){
      if(document.getElementById('btn-descargar-visibles'))return;
      const iosBtnBase={
        position:'fixed',right:'20px',color:'#fff',border:'1px solid rgba(255,255,255,0.3)',
        padding:'12px 16px',borderRadius:'999px',cursor:'pointer',zIndex:999999,
        boxShadow:'0 4px 12px rgba(0,0,0,0.15)',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        fontSize:'15px',fontWeight:'600',width:'230px',opacity:'0',backdropFilter:'blur(6px)',
        transition:`opacity ${FADE_TIME}ms ease, transform ${FADE_TIME}ms ease, box-shadow 0.15s ease`,
        display:'none',transformOrigin:'right center'
      };
      const btn1=document.createElement('button');
      btn1.id='btn-descargar-visibles';btn1.textContent='Descargar año visible';
      Object.assign(btn1.style,iosBtnBase,{background:'#59A5D8',bottom:'150px'});
      btn1.addEventListener('click',descargarVisiblesConConfirm);
  
      const btn2=document.createElement('button');
      btn2.id='btn-descargar-ciclo';btn2.textContent='Descargar 2017 a 2025';
      Object.assign(btn2.style,iosBtnBase,{background:'#386FA4',bottom:'100px'});
      btn2.addEventListener('click',startAutoCycle);
  
      const btn3=document.createElement('button');
      btn3.id='btn-descargar-rango';btn3.textContent='Descarga por rango';
      Object.assign(btn3.style,iosBtnBase,{background:'#133C55',bottom:'50px'});
      btn3.addEventListener('click',toggleRangePanel);
  
      [btn1,btn2,btn3].forEach(b=>{
        b.addEventListener('mousedown',()=>b.style.transform='scale(0.97)');
        b.addEventListener('mouseup',()=>b.style.transform='scale(1)');
      });
      document.body.append(btn1,btn2,btn3);
  
      const gear=document.createElement('button');
      gear.id='btn-toggle-panel';gear.textContent='⚙️';
      Object.assign(gear.style,{
        position:'fixed',right:'20px',bottom:'200px',background:'#424242',color:'#fff',
        border:'none',borderRadius:'50%',width:'46px',height:'46px',cursor:'pointer',
        zIndex:1000000,fontSize:'20px',boxShadow:'0 4px 12px rgba(0,0,0,0.25)',
        transition:'transform 0.2s ease'
      });
      gear.addEventListener('click',()=>{
        const vis=btn1.style.display!=='none';
        const arr=[btn1,btn2,btn3];
        vis?arr.forEach((b,i)=>fadeSlideOut(b,i*STAGGER_DELAY))
            :arr.forEach((b,i)=>fadeSlideIn(b,i*STAGGER_DELAY));
        gear.style.transform=vis?'rotate(0deg)':'rotate(90deg)';
        const p=document.getElementById('panel-rango');if(p&&vis)fadeOutAndRemove(p);
      });
      document.body.appendChild(gear);
    }
  
    // ===== Panel de rango =====
    function toggleRangePanel(){
      const ex=document.getElementById('panel-rango');
      if(ex){fadeOutAndRemove(ex);return;}
      const p=document.createElement('div');
      Object.assign(p.style,{
        position:'fixed',right:'260px',bottom:'50px',background:'#fafafa',
        border:'1px solid #ddd',borderRadius:'12px',padding:'14px',
        boxShadow:'0 4px 10px rgba(0,0,0,0.15)',zIndex:1000001,
        fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        minWidth:'240px',opacity:'0',transition:`opacity ${FADE_TIME}ms ease`
      });
      p.id='panel-rango';p.innerHTML='<b>Descarga por rango</b><br><br>';
      const years=[['','Ingrese año'],...Array.from({length:9},(_,i)=>[String(2017+i),String(2017+i)])];
      const months=[['','Ingrese mes'],...MONTHS];
      const mkSel=(opts,id)=>{const s=document.createElement('select');
        s.id=id;s.style.margin='4px';opts.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o);});return s;};
      const yD=mkSel(years,'rango-anio-desde'),mD=mkSel(months,'rango-mes-desde'),
            yH=mkSel(years,'rango-anio-hasta'),mH=mkSel(months,'rango-mes-hasta');
      p.append('Desde:',yD,mD,document.createElement('br'),'Hasta:',yH,mH,document.createElement('br'),document.createElement('br'));
      const go=document.createElement('button');go.textContent='Iniciar descarga';
      Object.assign(go.style,{background:'#133C55',color:'#fff',border:'none',padding:'8px 10px',
        borderRadius:'999px',cursor:'pointer',boxShadow:'0 4px 10px rgba(0,0,0,0.15)'});
      go.addEventListener('click',()=>{
        const sY=parseInt(yD.value),sM=parseInt(mD.value),eY=parseInt(yH.value),eM=parseInt(mH.value);
        if(!sY||!sM||!eY||!eM){alert('⚠️ Complete año y mes.');return;}
        if(sY*100+sM>=eY*100+eM){alert('⚠️ El rango debe ser coherente.');return;}
        fadeOutAndRemove(p);document.removeEventListener('click',out);
        startRangeCycle(sY,sM,eY,eM);
      });
      p.append(go);document.body.appendChild(p);requestAnimationFrame(()=>p.style.opacity='1');
      const out=e=>{if(!p.contains(e.target)&&!e.target.matches('#btn-descargar-rango')){fadeOutAndRemove(p);document.removeEventListener('click',out);}};
      setTimeout(()=>document.addEventListener('click',out),100);
    }
  
    // ===== Observador =====
    function observe(){
      const o=new MutationObserver(()=>{
        if(document.querySelector('button.descargar-recibo'))createButtons();
      });
      o.observe(document.body,{childList:true,subtree:true});
    }
    document.readyState==='loading'?document.addEventListener('DOMContentLoaded',observe):observe();
  })();
  