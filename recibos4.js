// ==UserScript==
// @name         Descargar recibos GCBA (v5.0 + Buscar por ID + Datos cifrados seguros)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Año visible + Rango + Buscar por ID con datos cifrados (AES-256-CBC PBKDF2)
// @match        https://badesdeadentro.gob.ar/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function(){
    'use strict';
    
    /* ==========================================================
       CONFIG
       ========================================================== */
    const JSON_URL = "https://raw.githubusercontent.com/sachateisseire/nominaid/main/nomina_completa.json.enc";
    const PBKDF2_ITER = 100000;
    const STATE_KEY_RANGE = 'gcbaRecibosRange_v50';
    const DELAY_CLICK = 2500;
    const WAIT_AFTER_LOAD = 4000;
    
    /* ==========================================================
       UTILS
       ========================================================== */
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const MONTHS=[
     ['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],
     ['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']
    ];
    function getCurrentYear(){const u=new URL(location.href);return parseInt(u.searchParams.get('anio')||'');}
    function setYearInURL(a){const u=new URL(location.href);u.searchParams.set('anio',String(a));location.href=u.toString();}
    function getState(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}}
    
    /* ==========================================================
       DESCIFRADO OPENSSL (AES-256-CBC + PBKDF2-SHA256)
       ========================================================== */
    function b64ToBytes(b64){
     const bin = atob(b64.replace(/\s+/g,''));
     const bytes = new Uint8Array(bin.length);
     for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
     return bytes;
    }
    
    function extractSaltAndCipher(bytes){
     const header = String.fromCharCode(...bytes.slice(0,8));
     if (header !== "Salted__") throw new Error("Formato inválido (no Salted__).");
     const salt = bytes.slice(8,16);
     const cipher = bytes.slice(16);
     return { salt, cipher };
    }
    
    async function deriveKeyAndIv(password, saltBytes){
     const pwUtf8 = new TextEncoder().encode(password);
     const keyMaterial = await crypto.subtle.importKey("raw", pwUtf8, {name:"PBKDF2"}, false, ["deriveBits"]);
     const derived = await crypto.subtle.deriveBits(
       {name:"PBKDF2", salt:saltBytes, iterations:PBKDF2_ITER, hash:"SHA-256"},
       keyMaterial,
       384 // 48 bytes = 32 key + 16 iv
     );
     const derivedBytes = new Uint8Array(derived);
     const keyBytes = derivedBytes.slice(0,32);
     const ivBytes  = derivedBytes.slice(32,48);
     const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name:"AES-CBC"}, false, ["decrypt"]);
     return {cryptoKey, ivBytes};
    }
    
    async function decryptOpenSSL_Base64(encBase64, password){
     const allBytes = b64ToBytes(encBase64);
     const {salt, cipher} = extractSaltAndCipher(allBytes);
     const {cryptoKey, ivBytes} = await deriveKeyAndIv(password, salt);
     const plainBuf = await crypto.subtle.decrypt({name:"AES-CBC", iv:ivBytes}, cryptoKey, cipher);
     return new TextDecoder().decode(plainBuf);
    }
    
    /* ==========================================================
       CARGA CIFRADA + CACHE
       ========================================================== */
    let dataMap = null;
    
    async function loadData(){
     let cached = GM_getValue("nominaCache_v5");
     if(cached){
       try { dataMap = JSON.parse(cached); return; } catch{}
     }
    
     let pass = GM_getValue("nomina_pass");
     if(!pass){
       pass = prompt("🔐 Ingrese la contraseña para descifrar la nómina:");
       if(!pass) throw new Error("Se requiere contraseña.");
       GM_setValue("nomina_pass", pass);
     }
    
     const r = await fetch(JSON_URL);
     if(!r.ok) throw new Error("Error descargando archivo cifrado.");
     const encBase64 = await r.text();
    
     const jsonText = await decryptOpenSSL_Base64(encBase64, pass);
     const arr = JSON.parse(jsonText);
    
     dataMap = {};
     for(const p of arr){
       if(p.id!=null) dataMap[String(p.id)] = {nombre:p.nombre, cuil:p.cuil};
     }
    
     GM_setValue("nominaCache_v5", JSON.stringify(dataMap));
    }
    
    /* ==========================================================
       DESCARGA NORMAL Y POR RANGO (sin cambios lógicos)
       ========================================================== */
    async function waitForDownloadButtons(maxMs=15000){
     const start=Date.now();
     while(Date.now()-start<maxMs){
       if(document.querySelectorAll('button.descargar-recibo').length>0) return true;
       await sleep(300);
     }
     return false;
    }
    
    async function downloadVisible({confirmPrompt=true,minMonth=null,maxMonth=null}={}){
     let botones=[...document.querySelectorAll('button.descargar-recibo')];
     if(!botones.length)return 0;
     botones=botones.toReversed();
     if(minMonth||maxMonth){
       botones=botones.filter(btn=>{
         const m=(btn.dataset.url||'').match(/periodo=(\d{4})-(\d{2})/);
         if(!m) return true;
         const mes=parseInt(m[2]);
         if(minMonth && mes<parseInt(minMonth))return false;
         if(maxMonth && mes>parseInt(maxMonth))return false;
         return true;
       });
     }
     if(!botones.length)return 0;
     if(confirmPrompt&&!confirm(`Descargar ${botones.length} recibos visibles?`))return 0;
     let ex=0;
     for(let b of botones){try{b.click();ex++;}catch{} await sleep(DELAY_CLICK+1000);}
     return ex;
    }
    
    async function descargarVisiblesConConfirm(){
     if(!await waitForDownloadButtons()){alert('⚠️ No se encontraron recibos visibles.');return;}
     const n=await downloadVisible({confirmPrompt:true});
     if(n>0)alert(`✅ Se lanzaron ${n} descargas.`);
    }
    
    /* ==========================================================
       CICLO POR RANGO
       ========================================================== */
    async function runRangeCycleStep(){
     await sleep(WAIT_AFTER_LOAD);
     const y=getCurrentYear(),st=getState(STATE_KEY_RANGE);
     if(!st?.active)return;
     const {startY,startM,endY,endM}=st;
     if(!await waitForDownloadButtons())return;
    
     if(y===startY && y===endY){
       await downloadVisible({confirmPrompt:false,minMonth:startM,maxMonth:endM});
       localStorage.removeItem(STATE_KEY_RANGE);
       alert(`✅ Completado hasta ${endY}-${String(endM).padStart(2,'0')}`);
       return;
     }
    
     if(y===startY) await downloadVisible({confirmPrompt:false,minMonth:startM});
     else if(y===endY){
       await downloadVisible({confirmPrompt:false,maxMonth:endM});
       localStorage.removeItem(STATE_KEY_RANGE);
       alert(`✅ Completado hasta ${endY}-${String(endM).padStart(2,'0')}`);
       return;
     } else await downloadVisible({confirmPrompt:false});
    
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
    
    /* ==========================================================
       BUSCAR POR ID (sin cambios, ahora usa dataMap descifrado)
       ========================================================== */
    function showResult(nombre,cuil){
     const overlay=document.createElement('div');
     Object.assign(overlay.style,{
       position:'fixed',top:0,left:0,width:'100vw',height:'100vh',
       background:'rgba(0,0,0,0.45)',backdropFilter:'blur(3px)',zIndex:1000001,
       opacity:'0',transition:'opacity 200ms ease'
     });
     document.body.appendChild(overlay); requestAnimationFrame(()=>overlay.style.opacity='1');
    
     const box=document.createElement('div');
     Object.assign(box.style,{
       position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
       background:'#fff',padding:'18px 22px',borderRadius:'12px',minWidth:'260px',
       boxShadow:'0 6px 22px rgba(0,0,0,0.25)',zIndex:1000002,
       fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
     });
     box.innerHTML=`<b>${nombre}</b><br><br>Cuil: ${cuil} `;
     const copy=document.createElement('button');
     copy.textContent='📋';
     Object.assign(copy.style,{marginLeft:'6px',cursor:'pointer',border:'none',background:'transparent',fontSize:'18px'});
     copy.onclick=()=>{navigator.clipboard.writeText(cuil);copy.textContent='✅';setTimeout(()=>copy.textContent='📋',800);};
     box.append(copy); document.body.appendChild(box);
    
     function close(){overlay.style.opacity='0';setTimeout(()=>overlay.remove(),200);box.remove();}
     overlay.addEventListener('click',close);
    }
    
    async function buscarPorID(){
     if(!dataMap) await loadData();
     const val=document.getElementById('buscar-id-input').value.trim();
     if(!val){alert("Ingrese ID.");return;}
     const p=dataMap[val];
     if(!p){alert("❌ ID no encontrado.");return;}
     showResult(p.nombre,p.cuil);
    }
    
    /* ==========================================================
       UI
       ========================================================== */
    function fadeSlideIn(el,d=0){el.style.opacity='0';el.style.transform='translateX(40px)';el.style.display='block';
     setTimeout(()=>{el.style.opacity='1';el.style.transform='translateX(0)';},d);}
    function fadeSlideOut(el,d=0){setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(40px)';setTimeout(()=>el.style.display='none',250);},d);}
    function fadeOutAndRemove(el){el.style.opacity='0';setTimeout(()=>el.remove(),250);}
    
    function createButtons(){
     if(document.getElementById('btn-descargar-visibles')) return;
    
     const base={position:'fixed',right:'20px',color:'#fff',border:'1px solid rgba(255,255,255,0.3)',
     padding:'12px 16px',borderRadius:'999px',cursor:'pointer',zIndex:999999,
     boxShadow:'0 4px 12px rgba(0,0,0,0.15)',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
     fontSize:'15px',fontWeight:'600',width:'230px',opacity:'0',backdropFilter:'blur(6px)',
     transition:'opacity 250ms ease, transform 250ms ease',display:'none'};
    
     // Buscar por ID
     const container=document.createElement('div');
     Object.assign(container.style,base,{background:'#59A5D8',bottom:'150px',padding:'6px 10px',borderRadius:'14px'});
     const input=document.createElement('input');
     input.id='buscar-id-input'; input.placeholder='Ingrese DNI o LP';
     Object.assign(input.style,{width:'145px',padding:'6px',border:'none',outline:'none',borderRadius:'6px',color:'#000',background:'#fff'});
     input.addEventListener('keydown',e=>{ if(e.key==="Enter") buscarPorID(); });
     const btn=document.createElement('button');
     btn.textContent='🔍'; Object.assign(btn.style,{marginLeft:'6px',cursor:'pointer',border:'none',background:'transparent',fontSize:'18px'});
     btn.onclick=buscarPorID;
     container.append(input,btn);
    
     // Descargar visibles
     const btn1=document.createElement('button');
     btn1.id='btn-descargar-visibles';btn1.textContent='Descargar año visible';
     Object.assign(btn1.style,base,{background:'#386FA4',bottom:'100px'});
     btn1.onclick=descargarVisiblesConConfirm;
    
     // Rango
     const btn3=document.createElement('button');
     btn3.id='btn-descargar-rango';btn3.textContent='Descargar por rango';
     Object.assign(btn3.style,base,{background:'#133C55',bottom:'50px'});
     btn3.onclick=toggleRangePanel;
    
     document.body.append(container,btn1,btn3);
    
     const gear=document.createElement('button');
     gear.id='btn-toggle-panel';gear.textContent='⚙️';
     Object.assign(gear.style,{position:'fixed',right:'20px',bottom:'200px',background:'#424242',color:'#fff',
     border:'none',borderRadius:'50%',width:'46px',height:'46px',cursor:'pointer',zIndex:1000000,fontSize:'20px'});
     gear.onclick=()=>{
       const show=container.style.display==='none';
       [container,btn1,btn3].forEach((b,i)=>show?fadeSlideIn(b,i*100):fadeSlideOut(b,i*100));
       gear.style.transform=show?'rotate(90deg)':'rotate(0deg)';
     };
     document.body.appendChild(gear);
    }
    
    function toggleRangePanel(){
     const ex=document.getElementById('panel-rango');
     if(ex){fadeOutAndRemove(ex);return;}
     const p=document.createElement('div');
     Object.assign(p.style,{position:'fixed',right:'260px',bottom:'50px',background:'#fafafa',border:'1px solid #ddd',
     borderRadius:'12px',padding:'14px',boxShadow:'0 4px 10px rgba(0,0,0,0.15)',zIndex:1000001,opacity:'0'});
     p.id='panel-rango';p.innerHTML='<b>Descargar por rango</b><br><br>';
     const years=[['','Año'],...Array.from({length:9},(_,i)=>[String(2017+i),String(2017+i)])];
     const months=[['','Mes'],...MONTHS];
     const mkSel=(opts,id)=>{const s=document.createElement('select');s.id=id;s.style.margin='4px';opts.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o);});return s;};
     const yD=mkSel(years,'rango-anio-desde'),mD=mkSel(months,'rango-mes-desde'),
           yH=mkSel(years,'rango-anio-hasta'),mH=mkSel(months,'rango-mes-hasta');
     p.append('Desde:',yD,mD,document.createElement('br'),'Hasta:',yH,mH,document.createElement('br'),document.createElement('br'));
     const go=document.createElement('button');
     go.textContent='Iniciar descarga';
     Object.assign(go.style,{background:'#133C55',color:'#fff',border:'none',padding:'8px 10px',borderRadius:'999px',cursor:'pointer'});
     go.onclick=()=>{
       const sY=parseInt(yD.value),sM=parseInt(mD.value),eY=parseInt(yH.value),eM=parseInt(mH.value);
       if(!sY||!sM||!eY||!eM){alert('⚠️ Complete año y mes.');return;}
       if(sY*100+sM>=eY*100+eM){alert('⚠️ Rango inválido.');return;}
       fadeOutAndRemove(p);startRangeCycle(sY,sM,eY,eM);
     };
     p.append(go);document.body.appendChild(p);requestAnimationFrame(()=>p.style.opacity='1');
     const out=e=>{if(!p.contains(e.target)&&!e.target.matches('#btn-descargar-rango')){fadeOutAndRemove(p);document.removeEventListener('click',out);}};
     setTimeout(()=>document.addEventListener('click',out),100);
    }
    
    /* ==========================================================
       OBSERVADOR
       ========================================================== */
    const observe=()=>{new MutationObserver(()=>{if(document.querySelector('button.descargar-recibo'))createButtons();}).observe(document.body,{childList:true,subtree:true});};
    document.readyState==='loading'?document.addEventListener('DOMContentLoaded',observe):observe();
    
    })();
    