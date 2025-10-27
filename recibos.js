// ==UserScript==
// @name         Descargar recibos GCBA (2017→2025 estable, validación sin duplicados)
// @namespace    http://tampermonkey.net/
// @version      2.6
// @description  Descarga robusta 2017→2025, sin duplicados, con verificación segura de botones
// @match        https://badesdeadentro.gob.ar/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
  
    const DELAY_CLICK = 2500;       // tiempo entre descargas (ms)
    const WAIT_AFTER_LOAD = 4000;   // espera inicial tras recargar (ms)
    const WAIT_BETWEEN_YEARS = 3500;
    const START_YEAR = 2017;
    const END_YEAR = 2025;
    const STATE_KEY = 'gcbaRecibosAuto_v2';
  
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
    function getCurrentYear() {
      const url = new URL(location.href);
      const p = parseInt(url.searchParams.get('anio') || '');
      if (Number.isFinite(p)) return p;
      const sel = document.querySelector('#edit-anio');
      const s = sel ? parseInt(sel.value) : NaN;
      return Number.isFinite(s) ? s : NaN;
    }
  
    function setYearInURL(year) {
      const url = new URL(location.href);
      url.searchParams.set('anio', String(year));
      location.href = url.toString();
    }
  
    async function waitForDownloadButtons(maxMs = 15000) {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const n = document.querySelectorAll('button.descargar-recibo').length;
        if (n > 0) return true;
        await sleep(300);
      }
      return false;
    }
  
    // --- Descarga secuencial, validando cada botón ---
    async function downloadVisible({ confirmPrompt = true } = {}) {
      let botones = Array.from(document.querySelectorAll('button.descargar-recibo'));
      if (!botones.length) {
        console.warn('No se encontraron botones .descargar-recibo');
        return 0;
      }
  
      // Invertimos el orden (de abajo hacia arriba)
      botones = botones.toReversed();
  
      if (confirmPrompt) {
        if (!confirm(`Descargar ${botones.length} recibos visibles?`)) return 0;
      }
  
      console.log(`📄 Iniciando descarga de ${botones.length} recibos...`);
  
      let exitos = 0;
      for (let i = 0; i < botones.length; i++) {
        const b = botones[i];
        if (!b || !b.dataset.url) {
          console.warn(`⚠️ Botón inválido o sin data-url (${i + 1}/${botones.length})`);
          continue;
        }
  
        console.log(`⬇️ [${i + 1}/${botones.length}] ${b.dataset.url}`);
        try {
          b.click();
          exitos++;
        } catch (e) {
          console.warn(`❌ Falló el click del botón ${i + 1}:`, e);
        }
  
        await sleep(DELAY_CLICK + 1000); // Espera extendida entre clicks
      }
  
      console.log(`✅ Descargas lanzadas (${exitos}/${botones.length})`);
      return exitos;
    }
  
    // --- Modo clásico (manual) ---
    async function descargarVisiblesConConfirm() {
      const ok = await waitForDownloadButtons();
      if (!ok) { alert('⚠️ No se encontraron recibos visibles.'); return; }
      const n = await downloadVisible({ confirmPrompt: true });
      if (n > 0) alert(`✅ Se lanzaron ${n} descargas.`);
    }
  
    // --- Modo automático (2017→2025) ---
    async function runAutoCycleStep() {
      await sleep(WAIT_AFTER_LOAD);
  
      const year = getCurrentYear();
      if (!Number.isFinite(year)) {
        console.warn('No se pudo determinar el año actual. Abortando ciclo.');
        localStorage.removeItem(STATE_KEY);
        return;
      }
  
      const state = getState();
      const endYear = state?.end ?? END_YEAR;
  
      if (year > endYear) {
        localStorage.removeItem(STATE_KEY);
        alert(`✅ Proceso automático completado hasta ${endYear}.`);
        return;
      }
  
      console.log(`🟩 [AUTO] Procesando año ${year}...`);
  
      const ok = await waitForDownloadButtons();
      if (!ok) {
        console.warn(`[AUTO] No se encontraron recibos en ${year}. Continuando...`);
      } else {
        const count = await downloadVisible({ confirmPrompt: false });
        console.log(`✅ [AUTO] Año ${year}: ${count} descargas lanzadas.`);
      }
  
      if (year < endYear) {
        const next = year + 1;
        console.log(`🔄 [AUTO] Preparando cambio a ${next}...`);
        const newState = { active: true, start: state.start, end: endYear, next };
        localStorage.setItem(STATE_KEY, JSON.stringify(newState));
  
        await sleep(WAIT_BETWEEN_YEARS);
        localStorage.setItem(STATE_KEY, JSON.stringify(newState));
  
        console.log(`🚀 Cambiando a ${next}...`);
        setYearInURL(next);
      } else {
        localStorage.removeItem(STATE_KEY);
        alert(`✅ Proceso automático completado hasta ${endYear}.`);
      }
    }
  
    function startAutoCycle() {
      alert(`🔁 Iniciando ciclo automático desde ${START_YEAR} hasta ${END_YEAR}...`);
      const state = { active: true, start: START_YEAR, end: END_YEAR };
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      setYearInURL(START_YEAR);
    }
  
    function getState() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
  
    // --- Reanudación ---
    (function resumeIfNeeded() {
      const state = getState();
      if (state?.active) {
        console.log('⏳ Reanudando ciclo automático...');
        runAutoCycleStep();
      }
    })();
  
    // --- UI (botones limpios) ---
    function createButtons() {
      if (document.getElementById('btn-descargar-visibles')) return;
  
      const baseStyle = {
        position: 'fixed',
        right: '20px',
        color: '#fff',
        border: 'none',
        padding: '12px 16px',
        borderRadius: '10px',
        cursor: 'pointer',
        zIndex: 999999,
        boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        fontWeight: '600',
        width: '230px'
      };
  
      const btn1 = document.createElement('button');
      btn1.id = 'btn-descargar-visibles';
      btn1.textContent = 'Descargar año visible';
      Object.assign(btn1.style, baseStyle, { background: '#1565c0', bottom: '70px' });
      btn1.addEventListener('click', descargarVisiblesConConfirm);
      document.body.appendChild(btn1);
  
      const btn2 = document.createElement('button');
      btn2.id = 'btn-descargar-ciclo';
      btn2.textContent = 'Descargar 2017 a 2025';
      Object.assign(btn2.style, baseStyle, { background: '#2e7d32', bottom: '20px' });
      btn2.addEventListener('click', startAutoCycle);
      document.body.appendChild(btn2);
  
      console.log('✅ Botones insertados');
    }
  
    function observeForButtons() {
      const obs = new MutationObserver(() => {
        const hay = document.querySelectorAll('button.descargar-recibo').length > 0;
        if (hay) createButtons();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  
    function hookURLChange() {
      if ('onurlchange' in window) {
        window.addEventListener('urlchange', () => setTimeout(createButtons, 1500));
      } else {
        observeForButtons();
      }
    }
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookURLChange);
    } else {
      hookURLChange();
    }
  })();
  