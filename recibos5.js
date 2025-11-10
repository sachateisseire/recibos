// ==UserScript==
// @name         Descargar recibos GCBA (v5.5 + Buscar ID AES-256)
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  Motor con buscador y base cifrada.
// @match        https://badesdeadentro.gob.ar/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function(){
    'use strict';
    
    /* =================== CONFIG =================== */
    const JSON_URL = "https://raw.githubusercontent.com/sachateisseire/nominaid/main/nomina_completa.json.enc";
    const PBKDF2_ITER = 100000;
    const STATE_KEY_RANGE = 'gcbaRecibosRange_v55';
    const DELAY_CLICK = 2500;
    const WAIT_AFTER_LOAD = 4000;
    
    const MONTHS=[
     ['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],
     ['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']
    ];
    
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    
    function getCurrentYear(){const u=new URL(location.href);return parseInt(u.searchParams.get('anio')||'');}
    function setYearInURL(a){const u=new URL(location.href);u.searchParams.set('anio',String(a));location.href=u.toString();}
    function getState(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}}
    
    /* =================== DESCIFRADO AES-256 (OpenSSL) =================== */
    function b64ToBytes(b64){
     const bin=atob(b64.replace(/\s+/g,''));
     const out=new Uint8Array(bin.length);
     for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
     return out;
    }
    function extractSaltAndCipher(bytes){
     if(String.fromCharCode(...bytes.slice(0,8))!=="Salted__") throw "❌ Archivo no es formato OpenSSL.";
     return {salt:bytes.slice(8,16),cipher:bytes.slice(16)};
    }
    async function deriveKeyAndIv(password,salt){
     const pw=new TextEncoder().encode(password);
     const keyMat=await crypto.subtle.importKey("raw",pw,"PBKDF2",false,["deriveBits"]);
     const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:PBKDF2_ITER,hash:"SHA-256"},keyMat,384);
     const arr=new Uint8Array(bits);
     const key=arr.slice(0,32),iv=arr.slice(32,48);
     return {
       cryptoKey:await crypto.subtle.importKey("raw",key,{name:"AES-CBC"},false,["decrypt"]),
       iv
     };
    }
    async function decryptAES(encB64,password){
     const bytes=b64ToBytes(encB64);
     const {salt,cipher}=extractSaltAndCipher(bytes);
     const {cryptoKey,iv}=await deriveKeyAndIv(password,salt);
     const plain=await crypto.subtle.decrypt({name:"AES-CBC",iv},cryptoKey,cipher);
     return new TextDecoder().decode(plain);
    }
    
    /* =================== CARGA Y CACHE =================== */
    let dataMap=null;
    
    async function loadData(){
     let cached = GM_getValue("nominaCache_v55");
     if(cached){
       try{ dataMap = JSON.parse(cached); return; }catch{}
     }
    
     let pass = GM_getValue("nomina_pass");
     if(!pass){
       pass = prompt("🔐 Ingrese contraseña para descifrar la nómina:");
       if(!pass) throw "Cancelado.";
       GM_setValue("nomina_pass", pass);
     }
    
     const r = await fetch(JSON_URL);
     const encBase64 = await r.text();
     const jsonText = await decryptAES(encBase64, pass);
     const arr = JSON.parse(jsonText);
    
     dataMap={};
     for(const p of arr) dataMap[String(p.id)]={nombre:p.nombre,cuil:p.cuil};
     GM_setValue("nominaCache_v55", JSON.stringify(dataMap));
    }
    
    /* =================== POPUP BLANCO SÓLIDO =================== */
    function showResult(nombre, cuil){
    
     const old=document.getElementById("resultado-popup-minimal");
     if(old) old.remove();
    
     const box=document.createElement('div');
     box.id="resultado-popup-minimal";
     Object.assign(box.style,{
       position:'fixed',
       bottom:'200px',   // misma altura que ⚙️
       right:'100px',    // a la izquierda del ⚙️
       padding:'14px 18px',
       background:'#ffffff',              // ← BLANCO SÓLIDO
       border:'1px solid #d5d5d5',        // borde sutil
       borderRadius:'14px',
       boxShadow:'0 6px 22px rgba(0,0,0,0.20)',
       fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
       zIndex:999999,
       minWidth:'260px',
       opacity:'0',
       transform:'translateY(12px)',
       transition:'opacity 200ms ease, transform 200ms ease'
     });
    
     const title=document.createElement('div');
     title.textContent=nombre;
     Object.assign(title.style,{fontWeight:'600',fontSize:'15px',marginBottom:'6px'});
    
     const line=document.createElement('div');
     line.textContent=`CUIL: ${cuil}`;
     Object.assign(line.style,{fontSize:'14px',display:'inline-block'});
    
     const copy=document.createElement('button');
     copy.textContent='📄';
     Object.assign(copy.style,{marginLeft:'8px',cursor:'pointer',border:'none',background:'transparent',fontSize:'17px'});
     copy.onclick=()=>{navigator.clipboard.writeText(cuil);copy.textContent='✅';setTimeout(()=>copy.textContent='📄',900);};
    
     const close=document.createElement('button');
     close.textContent='✕';
     Object.assign(close.style,{position:'absolute',top:'6px',right:'10px',cursor:'pointer',border:'none',background:'transparent',fontSize:'16px',color:'#333'});
     close.onclick=removePopup;
    
     box.append(title,line,copy,close);
     document.body.appendChild(box);
    
     requestAnimationFrame(()=>{box.style.opacity='1';box.style.transform='translateY(0)';});
    
     function removePopup(){
       box.style.opacity='0';
       box.style.transform='translateY(12px)';
       setTimeout(()=>box.remove(),200);
       document.removeEventListener('click',clickAway);
     }
     function clickAway(e){
       if(!box.contains(e.target)) removePopup();
     }
     setTimeout(()=>document.addEventListener('click',clickAway),50);
     setTimeout(removePopup,12000);
    }
    
    /* =================== BUSCAR ID =================== */
    async function buscarPorID(){
     if(!dataMap) await loadData();
     const val=document.getElementById('buscar-id-input').value.trim();
     if(!val){alert("Ingrese ID.");return;}
     const p=dataMap[val];
     if(!p){alert("❌ ID no encontrado.");return;}
     showResult(p.nombre,p.cuil);
    }
    
    /* =================== DESCARGAS =================== */
    async function waitForDownloadButtons(maxMs=15000){
     const start=Date.now();
     while(Date.now()-start<maxMs){
       if(document.querySelectorAll('button.descargar-recibo').length>0)return true;
       await sleep(300);
     }
     return false;
    }
    
    async function downloadVisible({confirmPrompt=true,minMonth=null,maxMonth=null}={}){
     let btns=[...document.querySelectorAll('button.descargar-recibo')];
     if(!btns.length)return 0;
     btns=btns.toReversed();
     if(minMonth||maxMonth){
       btns=btns.filter(b=>{
         const m=(b.dataset.url||'').match(/periodo=\d{4}-(\d{2})/);
         if(!m)return true;
         const mes=parseInt(m[1]);
         if(minMonth && mes<parseInt(minMonth))return false;
         if(maxMonth && mes>parseInt(maxMonth))return false;
         return true;
       });
     }
     if(!btns.length)return 0;
     if(confirmPrompt&&!confirm(`Descargar ${btns.length} recibos?`))return 0;
     let ex=0;
     for(let b of btns){try{b.click();ex++;}catch{} await sleep(DELAY_CLICK+1000);}
     return ex;
    }
    
    async function descargarVisiblesConConfirm(){
     if(!(await waitForDownloadButtons())){alert("⚠️ No hay recibos visibles.");return;}
     const n=await downloadVisible({confirmPrompt:true});
     if(n>0)alert(`✅ Se lanzaron ${n} descargas.`);
    }
    
    /* =================== DESCARGA POR RANGO =================== */
    async function runRangeCycleStep(){
     await sleep(WAIT_AFTER_LOAD);
     const y=getCurrentYear(),st=getState(STATE_KEY_RANGE);
     if(!st?.active)return;
     const {startY,startM,endY,endM}=st;
     if(!await waitForDownloadButtons())return;
    
     if(y===startY && y===endY){
       await downloadVisible({confirmPrompt:false,minMonth:startM,maxMonth:endM});
       localStorage.removeItem(STATE_KEY_RANGE);
       alert("✅ Completado.");
       return;
     }
    
     if(y===startY) await downloadVisible({confirmPrompt:false,minMonth:startM});
     else if(y===endY){await downloadVisible({confirmPrompt:false,maxMonth:endM});
       localStorage.removeItem(STATE_KEY_RANGE);alert("✅ Completado.");return;}
     else await downloadVisible({confirmPrompt:false});
    
     if(y<endY){
       const next=y+1;
       localStorage.setItem(STATE_KEY_RANGE,JSON.stringify({...st,nextY:next}));
       await sleep(5500);
       setYearInURL(next);
     } else localStorage.removeItem(STATE_KEY_RANGE);
    }
    
    function startRangeCycle(aY,aM,zY,zM){
     alert(`📅 Descarga desde ${aY}-${aM} hasta ${zY}-${zM}`);
     localStorage.setItem(STATE_KEY_RANGE,JSON.stringify({active:true,startY:aY,startM:aM,endY:zY,endM:zM,nextY:aY}));
     setYearInURL(aY);
    }
    
    (async()=>{const s=getState(STATE_KEY_RANGE),y=getCurrentYear();if(s?.active){const n=s.nextY??s.startY;if(y===n)await runRangeCycleStep();}})();
    
    /* =================== UI BOTONES =================== */
    function fadeIn(el,d=0){el.style.opacity='0';el.style.transform='translateX(40px)';el.style.display='block';
     setTimeout(()=>{el.style.opacity='1';el.style.transform='translateX(0)';},d);}
    function fadeOut(el,d=0){setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(40px)';setTimeout(()=>el.style.display='none',250);},d);}
    function fadeRemove(el){el.style.opacity='0';setTimeout(()=>el.remove(),250);}
    
    function createButtons(){
     if(document.getElementById('btn-descargar-visibles'))return;
    
     const base={position:'fixed',right:'20px',color:'#fff',border:'1px solid rgba(255,255,255,0.3)',
     padding:'12px 16px',borderRadius:'999px',cursor:'pointer',zIndex:999999,
     boxShadow:'0 4px 12px rgba(0,0,0,0.15)',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
     fontSize:'15px',fontWeight:'600',width:'230px',opacity:'0',backdropFilter:'blur(6px)',
     transition:'opacity 250ms ease, transform 250ms ease',display:'none'};
    
     const box=document.createElement('div');
     Object.assign(box.style,base,{background:'#59A5D8',bottom:'150px',padding:'6px 10px',borderRadius:'14px'});
    
     const input=document.createElement('input');
     input.id='buscar-id-input';input.placeholder='Ingrese ID';
     Object.assign(input.style,{width:'145px',padding:'6px',border:'none',outline:'none',borderRadius:'6px',color:'#000',background:'#fff'});
     input.addEventListener('keydown',e=>{if(e.key==="Enter")buscarPorID();});
    
     const b=document.createElement('button');
     b.textContent='🔍';Object.assign(b.style,{marginLeft:'6px',cursor:'pointer',border:'none',background:'transparent',fontSize:'18px'});
     b.onclick=buscarPorID;
     box.append(input,b);
    
     const btn1=document.createElement('button');
     btn1.id='btn-descargar-visibles';btn1.textContent='Descargar año visible';
     Object.assign(btn1.style,base,{background:'#386FA4',bottom:'100px'});
     btn1.onclick=descargarVisiblesConConfirm;
    
     const btn3=document.createElement('button');
     btn3.id='btn-descargar-rango';btn3.textContent='Descarga por rango';
     Object.assign(btn3.style,base,{background:'#133C55',bottom:'50px'});
     btn3.onclick=toggleRangePanel;
    
     document.body.append(box,btn1,btn3);
    
     const gear=document.createElement('button');
     gear.id='btn-toggle-panel';gear.textContent='⚙️';
     Object.assign(gear.style,{position:'fixed',right:'20px',bottom:'200px',background:'#424242',color:'#fff',
     border:'none',borderRadius:'50%',width:'46px',height:'46px',cursor:'pointer',zIndex:1000000,fontSize:'20px'});
     gear.onclick=()=>{
       const show=box.style.display==='none';
       [box,btn1,btn3].forEach((x,i)=>show?fadeIn(x,i*100):fadeOut(x,i*100));
       gear.style.transform=show?'rotate(90deg)':'rotate(0deg)';
     };
     document.body.appendChild(gear);
    }
    
    function toggleRangePanel(){
     const ex=document.getElementById('panel-rango');
     if(ex){fadeRemove(ex);return;}
     const p=document.createElement('div');
     Object.assign(p.style,{position:'fixed',right:'260px',bottom:'50px',background:'#fafafa',border:'1px solid #ddd',
     borderRadius:'12px',padding:'14px',boxShadow:'0 4px 10px rgba(0,0,0,0.15)',zIndex:1000001,opacity:'0'});
     p.id='panel-rango';p.innerHTML='<b>Descarga por rango</b><br><br>';
     const years=[['','Año'],...Array.from({length:9},(_,i)=>[String(2017+i),String(2017+i)])];
     const months=[['','Mes'],...MONTHS];
     const mk=(ops,id)=>{const s=document.createElement('select');s.id=id;s.style.margin='4px';ops.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o);});return s;};
     const yD=mk(years,'rango-anio-desde'),mD=mk(months,'rango-mes-desde'),
           yH=mk(years,'rango-anio-hasta'),mH=mk(months,'rango-mes-hasta');
     p.append('Desde:',yD,mD,document.createElement('br'),'Hasta:',yH,mH,document.createElement('br'),document.createElement('br'));
     const go=document.createElement('button');
     go.textContent='Iniciar descarga';
     Object.assign(go.style,{background:'#133C55',color:'#fff',border:'none',padding:'8px 10px',borderRadius:'999px',cursor:'pointer'});
     go.onclick=()=>{
       const sY=parseInt(yD.value),sM=parseInt(mD.value),eY=parseInt(yH.value),eM=parseInt(mH.value);
       if(!sY||!sM||!eY||!eM)return alert('⚠️ Complete.');
       if(sY*100+sM>=eY*100+eM)return alert('⚠️ Rango inválido.');
       fadeRemove(p);startRangeCycle(sY,sM,eY,eM);
     };
     p.append(go);document.body.appendChild(p);requestAnimationFrame(()=>p.style.opacity='1');
     const out=e=>{if(!p.contains(e.target)&&!e.target.matches('#btn-descargar-rango')){fadeRemove(p);document.removeEventListener('click',out);}};
     setTimeout(()=>document.addEventListener('click',out),80);
    }
    
    /* =================== OBSERVE =================== */
    const obs=new MutationObserver(()=>{if(document.querySelector('button.descargar-recibo'))createButtons();});
    document.readyState==='loading'?
     document.addEventListener('DOMContentLoaded',()=>obs.observe(document.body,{childList:true,subtree:true})):
     obs.observe(document.body,{childList:true,subtree:true});
    
    })();
    