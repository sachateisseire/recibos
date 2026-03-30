// ==UserScript==
// @name         Descargar recibos GCBA (multi CUIL rápido)
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Multi CUIL + rango mes/año + rápido y estable
// @match        https://badesdeadentro.gob.ar/*
// @grant        none
// ==/UserScript==

(function(){
'use strict';

const MIN_DELAY = 800;
const MAX_DELAY = 1100;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randomDelay(){ return MIN_DELAY + Math.random()*(MAX_DELAY-MIN_DELAY); }

// 🔹 setear año
function setYear(year){
    const url = new URL(location.href);
    url.searchParams.set('anio', year);
    location.href = url.toString();
}

// 🔹 setear CUIL
function setCuilInicial(cuil, year){
    const url = new URL(location.href);
    url.pathname = '/recibos/mis-recibos';
    url.searchParams.set('anio', year);
    url.searchParams.set('cuil', cuil);
    location.href = url.toString();
}

function parseMesAnio(str){
    const [mes, anio] = str.split(':').map(Number);
    return {mes, anio};
}

// ⚡ espera rápida
async function esperarRecibos(maxMs=5000){

    const start = Date.now();

    while(Date.now()-start < maxMs){

        const botones = document.querySelectorAll('button.descargar-recibo');

        if(botones.length > 0){
            return true;
        }

        if(Date.now()-start > 1500){
            return false;
        }

        await sleep(250);
    }

    return false;
}

async function descargarVisible(filtros){

    let btns = [...document.querySelectorAll('button.descargar-recibo')];
    let urls = btns.map(b=>b.dataset.url).filter(Boolean);

    let items = urls.map(u => {
        const m = u.match(/periodo=(\d{4})-(\d{2})/);
        return {
            url: u,
            year: m ? parseInt(m[1]) : 0,
            month: m ? parseInt(m[2]) : 0
        };
    });

    const {desde, hasta} = filtros;

    items = items.filter(item => {

        const afterDesde =
            (item.year > desde.anio) ||
            (item.year === desde.anio && item.month >= desde.mes);

        const beforeHasta =
            (item.year < hasta.anio) ||
            (item.year === hasta.anio && item.month <= hasta.mes);

        return afterDesde && beforeHasta;
    });

    items.sort((a,b)=>{
        if(a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
    });

    for(const item of items){
        try{
            const a=document.createElement('a');
            a.href=item.url;
            a.download='';
            document.body.appendChild(a);
            a.click();
            a.remove();
        }catch(e){
            console.log('Error descarga:', e);
        }

        await sleep(randomDelay());
    }
}

async function flujoCompleto(){

    const cuilInput = prompt('CUILs separados por ":"');
    const desdeInput = prompt('Desde (MM:YYYY)');
    const hastaInput = prompt('Hasta (MM:YYYY)');

    if(!cuilInput || !desdeInput || !hastaInput) return;

    const cuils = cuilInput.split(':');
    const desde = parseMesAnio(desdeInput);
    const hasta = parseMesAnio(hastaInput);

    localStorage.setItem('autoDescarga', JSON.stringify({
        cuils,
        index: 0,
        desde,
        hasta,
        actual: desde.anio,
        iniciado: false
    }));

    setCuilInicial(cuils[0], desde.anio);
}

async function continuarFlujo(){

    const data = JSON.parse(localStorage.getItem('autoDescarga')||'null');
    if(!data) return;

    const {cuils, index, desde, hasta, iniciado} = data;
    let {actual} = data;

    const cuil = cuils[index];

    // primera carga
    if(!iniciado){
        await esperarRecibos();
        data.iniciado = true;
        localStorage.setItem('autoDescarga', JSON.stringify(data));
    }

    const ok = await esperarRecibos();

    if(ok){
        await descargarVisible({desde, hasta});
    }else{
        console.log('⚡ Año sin datos:', actual, 'CUIL:', cuil);
    }

    // avanzar año
    if(actual < hasta.anio){

        actual++;

        localStorage.setItem('autoDescarga', JSON.stringify({
            ...data,
            actual
        }));

        await sleep(2000);
        setYear(actual);

    } else {

        // 🔥 siguiente CUIL
        if(index < cuils.length - 1){

            const nextIndex = index + 1;

            localStorage.setItem('autoDescarga', JSON.stringify({
                ...data,
                index: nextIndex,
                actual: desde.anio,
                iniciado: false
            }));

            await sleep(2000);
            setCuilInicial(cuils[nextIndex], desde.anio);

        } else {

            localStorage.removeItem('autoDescarga');
            alert('✅ Descarga completa de todos los CUILs');
        }
    }
}

function crearBoton(){

    if(document.getElementById('btn-descarga-auto')) return;

    const btn=document.createElement('button');
    btn.id='btn-descarga-auto';
    btn.textContent='Descarga automática';

    Object.assign(btn.style,{
        position:'fixed',
        right:'20px',
        bottom:'260px',
        padding:'12px 16px',
        background:'#2e7d32',
        color:'#fff',
        border:'none',
        borderRadius:'999px',
        zIndex:999999,
        cursor:'pointer'
    });

    btn.onclick=flujoCompleto;
    document.body.appendChild(btn);
}

const obs=new MutationObserver(()=> crearBoton());
obs.observe(document.body,{childList:true,subtree:true});

continuarFlujo();

})();
