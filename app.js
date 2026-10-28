(function(){
"use strict";
const $ = s => document.querySelector(s);
const CHIAVE = "carburante-giusto-v1";
const FATTORE_STRADA = 1.3;
const NOMI_CAT = {B:"Benzina",G:"Gasolio",L:"GPL",M:"Metano",H:"HVO",N:"GNL"};
const PESO = c => c === "M" || c === "N";   // si vende a kg

// ---------- stato ----------
const STATO_BASE = {
  profili:[
    {id:"p1", nome:"La mia auto", cat:"B", servizio:"self", litri:40, consumo:15, premium:false},
    {id:"p2", nome:"Moto", cat:"B", servizio:"self", litri:12, consumo:22, premium:false}
  ],
  attivo:"p1", modalita:"vicino", raggio:10, corridoio:3, giorni:7, noAutostrada:false, escludi:"",
  partenza:{nome:"Parma (PR)", lat:44.8015, lon:10.3279}, arrivo:null, ordine:"costo"
};
let S;
try { S = Object.assign({}, STATO_BASE, JSON.parse(localStorage.getItem(CHIAVE) || "{}")); } catch(e){ S = Object.assign({}, STATO_BASE); }
if (!Array.isArray(S.profili) || !S.profili.length) S.profili = STATO_BASE.profili;
function salva(){ try { localStorage.setItem(CHIAVE, JSON.stringify(S)); } catch(e){} }
const prof = () => S.profili.find(p => p.id === S.attivo) || S.profili[0];

// ---------- dati ----------
let IND = null, COMUNI = [], STORICO = [];
const tessere = new Map();      // chiave -> Promise<array>
const comuniT = new Map();
let estrDate = null;

function giorno(q){ // AAAAMMGGhhmm -> Date
  const s = String(q); return new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12));
}
// Nell'app Android i prezzi freschi arrivano dal repository GitHub; quelli dentro l'app servono se manca la rete.
const REMOTO = "https://raw.githubusercontent.com/massxxx/carburante-giusto/main/";
const IN_APP = !!window.Capacitor || location.hostname === "localhost" && !location.port;
let BASE_DATI = "";
function caricaJSON(u){ if (u.startsWith("dati/")) u = BASE_DATI + u; return fetch(u, {cache:"no-cache"}).then(r => { if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }); }
function tessera(k){
  if (!tessere.has(k)) tessere.set(k, IND.tessere.includes(k) ? caricaJSON("dati/t/"+k+".json").then(a => a.map(r => ({
    id:r[0], b:r[1], n:r[2], i:r[3], c:r[4], p:r[5], a:r[6], la:r[7], lo:r[8], pr:r[9]
  }))).catch(() => []) : Promise.resolve([]));
  return tessere.get(k);
}
function chiaviBox(s,w,n,e){ const k=[]; for(let a=Math.floor(s);a<=Math.floor(n);a++) for(let b=Math.floor(w);b<=Math.floor(e);b++) k.push(a+"_"+b); return k; }

// ---------- geometria ----------
const R = 6371;
function dist(a,b,c,d){ const r=Math.PI/180, x=(d-b)*r*Math.cos((a+c)/2*r), y=(c-a)*r; return Math.sqrt(x*x+y*y)*R; }
function distSegmento(p, A, B){ // km, proiezione locale
  const r=Math.PI/180, k=Math.cos(A.lat*r)*R*r, ky=R*r;
  const ax=A.lon*k, ay=A.lat*ky, bx=B.lon*k-ax, by=B.lat*ky-ay, px=p.lo*k-ax, py=p.la*ky-ay;
  const L=bx*bx+by*by; let t = L ? (px*bx+py*by)/L : 0; t=Math.max(0,Math.min(1,t));
  const dx=px-t*bx, dy=py-t*by; return {d:Math.sqrt(dx*dx+dy*dy), t};
}

// ---------- formati ----------
const eur = v => v.toLocaleString("it-IT",{style:"currency",currency:"EUR",minimumFractionDigits:2,maximumFractionDigits:2});
function prezzoHTML(v){ const s=v.toFixed(3).replace(".",","); return s.slice(0,-1)+"<sup>"+s.slice(-1)+"</sup>"; }
const km = v => v < 10 ? v.toFixed(1).replace(".",",")+" km" : Math.round(v)+" km";
const dataIT = d => d.toLocaleDateString("it-IT",{day:"numeric",month:"long"});
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function quandoIT(q){ const d=giorno(q); return d.toLocaleDateString("it-IT",{day:"numeric",month:"short"})+" "+d.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}); }
function titoloCase(s){ return s.toLowerCase().replace(/(^|[\s'\-(])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase()); }

// ---------- prezzo adatto al profilo ----------
function prezzoPer(st, p){
  let best = null;
  const limite = estrDate ? new Date(estrDate.getTime() - S.giorni*86400000) : null;
  for (const x of st.pr){
    const cat = x[1];
    if (!(cat === p.cat || (p.premium && cat === p.cat+"+"))) continue;
    if (p.servizio === "self" && x[3] !== 1) continue;
    if (p.servizio === "servito" && x[3] !== 0) continue;
    if (limite && giorno(x[4]) < limite) continue;
    if (!best || x[2] < best[2]) best = x;
  }
  return best;
}

// ---------- calcolo ----------
let ULTIMI = [], SCELTO = null, giro = 0;
async function calcola(){
  if (!IND) return;
  const p = prof(), mio = ++giro;
  const A = S.partenza, B = S.modalita === "percorso" ? S.arrivo : null;
  let box;
  if (B){
    const m = S.corridoio/100 + .05;
    box = [Math.min(A.lat,B.lat)-m, Math.min(A.lon,B.lon)-m, Math.max(A.lat,B.lat)+m, Math.max(A.lon,B.lon)+m];
  } else {
    const dl = S.raggio/111, dn = S.raggio/(111*Math.cos(A.lat*Math.PI/180));
    box = [A.lat-dl, A.lon-dn, A.lat+dl, A.lon+dn];
  }
  $("#loading").hidden = false;
  const liste = await Promise.all(chiaviBox(box[0],box[1],box[2],box[3]).map(tessera));
  if (mio !== giro) return;
  $("#loading").hidden = true;
  const escl = S.escludi.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const lista of liste) for (const st of lista){
    if (S.noAutostrada && st.a) continue;
    if (escl.length && escl.some(e => (st.b+" "+st.n).toLowerCase().includes(e))) continue;
    let d, deviazione, lungo = 0;
    if (B){
      const r = distSegmento(st, A, B);
      if (r.d > S.corridoio) continue;
      d = r.d; deviazione = 2*r.d*FATTORE_STRADA; lungo = r.t;
    } else {
      d = dist(A.lat,A.lon,st.la,st.lo);
      if (d > S.raggio) continue;
      deviazione = 2*d*FATTORE_STRADA;
    }
    const x = prezzoPer(st, p);
    if (!x) continue;
    const prezzo = x[2];
    const costoStrada = deviazione / p.consumo * prezzo;
    out.push({st, x, prezzo, d, deviazione, lungo, costoStrada, pieno: p.litri*prezzo, tot: p.litri*prezzo + costoStrada});
  }
  ULTIMI = out;
  const ordinati = ordina(out);
  SCELTO = ordinati.length ? ordinati[0].st.id : null;
  disegnaRisultati(ordinati);
  disegnaMappa(out);
  disegnaMedie(out);
}
function ordina(a){
  const c = a.slice();
  if (S.ordine === "prezzo") c.sort((x,y) => x.prezzo-y.prezzo || x.d-y.d);
  else if (S.ordine === "distanza") c.sort((x,y) => (S.modalita==="percorso" ? x.lungo-y.lungo : x.d-y.d));
  else c.sort((x,y) => x.tot-y.tot || x.d-y.d);
  return c;
}

// ---------- navigazione ----------
function linkNav(st){
  const d = st.la+","+st.lo;
  if (S.modalita === "percorso" && S.arrivo){
    const o = S.partenza.lat+","+S.partenza.lon, b = S.arrivo.lat+","+S.arrivo.lon;
    return [
      ["Google Maps", "https://www.google.com/maps/dir/?api=1&origin="+o+"&destination="+b+"&waypoints="+d+"&travelmode=driving", true],
      ["Waze", "https://waze.com/ul?ll="+d+"&navigate=yes", false],
      ["Mappe Apple", "https://maps.apple.com/?saddr="+o+"&daddr="+d+"&dirflg=d", false]
    ];
  }
  return [
    ["Google Maps", "https://www.google.com/maps/dir/?api=1&destination="+d+"&travelmode=driving", true],
    ["Waze", "https://waze.com/ul?ll="+d+"&navigate=yes", false],
    ["Mappe Apple", "https://maps.apple.com/?daddr="+d+"&dirflg=d", false]
  ];
}
function navHTML(st, cls){
  return linkNav(st).map(([t,u,pr]) => `<a class="btn small ${pr?"primary":""} ${cls||""}" href="${u}" target="_blank" rel="noopener">${t}</a>`).join("");
}
const nomeSt = st => st.b && st.b !== "Pompe Bianche" ? st.b : (titoloCase(st.n) || "Distributore");

// ---------- risultati ----------
function disegnaRisultati(ord){
  const p = prof(), u = PESO(p.cat) ? "kg" : "l";
  const box = $("#migliore"), lista = $("#lista");
  if (!ord.length){
    box.innerHTML = "";
    lista.innerHTML = `<div class="empty">Nessun distributore con ${NOMI_CAT[p.cat].toLowerCase()}${p.servizio!=="tutti"?" "+p.servizio:""} ${S.modalita==="percorso"?"entro "+S.corridoio+" km dal percorso":"entro "+S.raggio+" km"}. Allarga il raggio, scegli «Tutti» o accetta il carburante speciale.</div>`;
    return;
  }
  const media = ord.reduce((s,o)=>s+o.prezzo,0)/ord.length;
  const b = ord.slice().sort((x,y)=>x.tot-y.tot)[0];
  const risp = p.litri*media - b.pieno;
  const piuVicino = ord.slice().sort((x,y)=>x.d-y.d)[0];
  const rispVicino = piuVicino.tot - b.tot;
  box.innerHTML = `<div class="best">
    <div class="label">Il più conveniente per ${esc(p.nome)}</div>
    <div class="totem"><span class="price">${prezzoHTML(b.prezzo)}</span><span>€/${u} · ${esc(b.x[3]?"self":"servito")} · ${esc(IND.nomi[b.x[0]])}</span></div>
    <div><h3>${esc(nomeSt(b.st))} — ${esc(titoloCase(b.st.c))}</h3><div class="addr">${esc(titoloCase(b.st.i))}${b.st.a?" · autostrada":""}</div></div>
    <div class="facts num">
      <span>${S.modalita==="percorso"?"A "+km(b.d)+" dal percorso":"A "+km(b.d)+" in linea d'aria"}</span>
      <span>${p.litri} ${u}: <b>${eur(b.pieno)}</b></span>
      <span>Strada: ${eur(b.costoStrada)}</span>
      <span>Spesa vera: <b>${eur(b.tot)}</b></span>
    </div>
    <div class="facts num">
      ${risp > 0.005 ? `<span class="saving">${eur(risp)} in meno della media della zona (${prezzoHTML(media).replace(/<\/?sup>/g,"")} €/${u})</span>` : `<span>In linea con la media della zona</span>`}
      ${piuVicino.st.id !== b.st.id && rispVicino > 0.005 ? `<span>Rispetto al più vicino (${esc(nomeSt(piuVicino.st))}, ${km(piuVicino.d)}) risparmi ${eur(rispVicino)}</span>` : ""}
      <span>Prezzo comunicato il ${quandoIT(b.x[4])}</span>
    </div>
    <div class="nav">${navHTML(b.st)}</div>
  </div>`;
  const prezzi = ord.map(o=>o.prezzo).sort((a,b)=>a-b);
  const q1 = prezzi[Math.floor(prezzi.length/3)], q2 = prezzi[Math.floor(prezzi.length*2/3)];
  const mostra = ord.slice(0, 40);
  lista.innerHTML = mostra.map((o,i) => {
    const tier = o.prezzo <= q1 ? "good" : o.prezzo <= q2 ? "mid" : "bad";
    const vecchio = estrDate && (estrDate - giorno(o.x[4])) > 3*86400000;
    return `<button type="button" class="card" data-id="${o.st.id}" ${o.st.id===SCELTO?'aria-current="true"':""}>
      <span class="rank num">${i+1}</span>
      <span class="who"><b><i class="tier" style="background:var(--${tier})"></i>${esc(nomeSt(o.st))} · ${esc(titoloCase(o.st.c))}</b><span>${esc(titoloCase(o.st.i))}</span></span>
      <span class="p"><span class="price">${prezzoHTML(o.prezzo)}</span><br><span class="tot num">${eur(o.tot)}</span></span>
      <span class="tags"><span class="tag num">${km(o.d)}</span><span class="tag">${o.x[3]?"self":"servito"}</span>${o.x[1].endsWith("+")?`<span class="tag">${esc(IND.nomi[o.x[0]])}</span>`:""}${o.st.a?'<span class="tag">autostrada</span>':""}${o.st.id===b.st.id?'<span class="tag good">più conveniente</span>':""}${o.st.id===piuVicino.st.id?'<span class="tag">più vicino</span>':""}${vecchio?`<span class="tag warn">prezzo del ${dataIT(giorno(o.x[4]))}</span>`:""}</span>
    </button>`;
  }).join("") + (ord.length > 40 ? `<p class="hint">Altri ${ord.length-40} distributori sono sulla mappa.</p>` : "");
}

// ---------- medie ----------
function disegnaMedie(out){
  const p = prof(), u = PESO(p.cat) ? "€/kg" : "€/l";
  const it = IND.italia[p.cat] || {}, s = p.servizio === "servito" ? "servito" : "self";
  const provN = (()=>{ const c = COMUNI.find(c => c[2]===S.partenza.lat && c[3]===S.partenza.lon); return c ? c[1] : (out[0] && out[0].st.p); })();
  const pv = provN && IND.province[provN] && IND.province[provN][p.cat] && IND.province[provN][p.cat][s];
  const zona = out.length ? out.reduce((a,o)=>a+o.prezzo,0)/out.length : null;
  const min = out.length ? Math.min(...out.map(o=>o.prezzo)) : null;
  const tile = (t,v,sub) => `<div class="stat"><div class="label">${t}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $("#medie").innerHTML =
    (min!=null ? tile("Il più basso qui", prezzoHTML(min), u+" · "+out.length+" distributori") : "") +
    (zona!=null ? tile("Media qui", prezzoHTML(zona), u+" · quelli in elenco") : "") +
    (pv ? tile("Provincia di "+provN, prezzoHTML(pv.media), u+" "+s+" · "+pv.n+" prezzi") : "") +
    (it[s] ? tile("Italia", prezzoHTML(it[s].media), u+" "+s+" · mediana "+it[s].mediana.toFixed(3).replace(".",",")) : "");
  // storico
  const pts = STORICO.map(v => ({d:v.d, y:v[p.cat] && v[p.cat][s==="self"?0:1]})).filter(v => v.y);
  const el = $("#storico");
  if (pts.length < 2){
    el.innerHTML = `<p class="hint">Lo storico parte dal ${pts.length? dataIT(new Date(pts[0].d)) : "primo aggiornamento"}: ogni giorno si aggiunge un punto${pts.length?` (oggi ${pts[0].y.toFixed(3).replace(".",",")} ${u})`:""}.</p>`;
    return;
  }
  const W=600,H=70,P=6, ys=pts.map(v=>v.y), lo=Math.min(...ys), hi=Math.max(...ys), sp=(hi-lo)||0.01;
  const X=i=>P+i*(W-2*P)/(pts.length-1), Y=v=>H-P-(v-lo)/sp*(H-2*P);
  const path=pts.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v.y).toFixed(1)).join(" ");
  el.innerHTML = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Media Italia dal ${dataIT(new Date(pts[0].d))}"><path d="${path} L ${X(pts.length-1)} ${H} L ${X(0)} ${H} Z" fill="var(--accent-soft)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${X(pts.length-1)}" cy="${Y(ys[ys.length-1])}" r="4" fill="var(--accent)"/></svg>
  <p class="hint num">Dal ${dataIT(new Date(pts[0].d))} (${lo.toFixed(3).replace(".",",")}–${hi.toFixed(3).replace(".",",")} ${u}) a oggi ${ys[ys.length-1].toFixed(3).replace(".",",")} ${u}.</p>`;
}

// ---------- mappa ----------
let map, lyBase, lyComuni, lyLabels, lyStaz, lyPos, renderer, markers = new Map();
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function iniziaMappa(){
  if (!window.L){ $("#map").innerHTML = '<p class="empty" style="margin:16px">La mappa non si è caricata. La classifica funziona lo stesso.</p>'; return; }
  renderer = L.canvas({padding:.3});
  map = L.map("map", {zoomControl:true, preferCanvas:true, minZoom:5, maxZoom:17, zoomSnap:.5, attributionControl:true})
    .setView([S.partenza.lat, S.partenza.lon], 11);
  map.attributionControl.setPrefix("").addAttribution("Prezzi MIMIT");
  lyBase = L.layerGroup().addTo(map); lyComuni = L.layerGroup().addTo(map); lyLabels = L.layerGroup().addTo(map);
  lyStaz = L.layerGroup().addTo(map); lyPos = L.layerGroup().addTo(map);
    map.on("click", e => {
    const ll = e.latlng, c = vicinoComune(ll.lat, ll.lng);
    const nome = "Punto sulla mappa" + (c ? " vicino a "+c[0] : "");
    const html = `<div class="pop"><h4>${esc(nome)}</h4><div class="nav">
      <button class="btn small primary" type="button" data-qui="p">Sono qui</button>
      ${S.modalita==="percorso"?'<button class="btn small" type="button" data-qui="a">Vado qui</button>':""}</div></div>`;
    const pop = L.popup().setLatLng(ll).setContent(html).openOn(map);
    setTimeout(() => {
      const el = pop.getElement(); if (!el) return;
      el.querySelectorAll("[data-qui]").forEach(bt => bt.addEventListener("click", () => {
        const pos = {nome, lat:+ll.lat.toFixed(5), lon:+ll.lng.toFixed(5)};
        if (bt.dataset.qui === "p") S.partenza = pos; else S.arrivo = pos;
        map.closePopup(); cambia();
      }));
    }, 0);
  });
}
let lyTiles = null, temaTiles = "";
function scuro(){ const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
async function disegnaBase(){
  if (!map) return;
  const tema = scuro() ? "dark_all" : "rastertiles/voyager";
  if (lyTiles && temaTiles === tema) return;
  if (lyTiles) map.removeLayer(lyTiles);
  temaTiles = tema;
  lyTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/"+tema+"/{z}/{x}/{y}{r}.png", {subdomains:"abcd", maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'}).addTo(map);
}
function aggiornaComuni(){}
function disegnaMappa(out){
  if (!map) return;
  lyStaz.clearLayers(); lyPos.clearLayers(); markers.clear();
  const p = prof(), u = PESO(p.cat) ? "kg" : "l";
  const prezzi = out.map(o=>o.prezzo).sort((a,b)=>a-b);
  const q1 = prezzi[Math.floor(prezzi.length/3)], q2 = prezzi[Math.floor(prezzi.length*2/3)];
  const best = out.length ? out.reduce((a,o)=>o.tot<a.tot?o:a) : null;
  const col = {good:tok("--good"), mid:tok("--mid"), bad:tok("--bad")};
  out.forEach(o => {
    const t = o.prezzo <= q1 ? "good" : o.prezzo <= q2 ? "mid" : "bad";
    const m = L.circleMarker([o.st.la,o.st.lo], {renderer, radius: o===best?10:6.5, color:tok("--surface"), weight:o===best?3:1.5, fillColor:col[t], fillOpacity:1});
    m.bindPopup(() => popupHTML(o.st, o), {maxWidth:300});
    m.on("click", () => evidenzia(o.st.id, false));
    m.addTo(lyStaz); markers.set(o.st.id, m);
  });
  if (best){
    L.tooltip({permanent:true, direction:"top", offset:[0,-10], className:"lbl-best", interactive:false})
      .setLatLng([best.st.la,best.st.lo]).setContent(best.prezzo.toFixed(3).replace(".",",")).addTo(lyPos);
  }
  const A = S.partenza;
  L.circleMarker([A.lat,A.lon], {renderer, radius:7, color:tok("--surface"), weight:3, fillColor:tok("--fg"), fillOpacity:1, interactive:false}).addTo(lyPos);
  if (S.modalita === "percorso" && S.arrivo){
    const B = S.arrivo;
    L.polyline([[A.lat,A.lon],[B.lat,B.lon]], {renderer, color:tok("--accent"), weight:3, dashArray:"8 6", interactive:false}).addTo(lyPos);
    L.circleMarker([B.lat,B.lon], {renderer, radius:7, color:tok("--surface"), weight:3, fillColor:tok("--accent"), fillOpacity:1, interactive:false}).addTo(lyPos);
  } else {
    L.circle([A.lat,A.lon], {renderer, radius:S.raggio*1000, color:tok("--fg"), weight:1, opacity:.35, fill:false, interactive:false}).addTo(lyPos);
  }
}
function inquadra(){
  if (!map) return;
  const A = S.partenza;
  if (S.modalita === "percorso" && S.arrivo) map.fitBounds([[A.lat,A.lon],[S.arrivo.lat,S.arrivo.lon]], {padding:[40,40]});
  else map.fitBounds(L.latLng(A.lat,A.lon).toBounds(S.raggio*2000), {padding:[10,10]});
}
function popupHTML(st, o){
  const p = prof();
  const righe = st.pr.slice().sort((a,b)=> a[1].localeCompare(b[1]) || b[3]-a[3]).map(x => {
    const sel = o && x === o.x;
    return `<tr class="${sel?"sel":""}"><td>${esc(IND.nomi[x[0]])} <span class="d">${x[3]?"self":"servito"} · ${quandoIT(x[4])}</span></td><td class="r">${x[2].toFixed(3).replace(".",",")}</td></tr>`;
  }).join("");
  const extra = o ? `<div class="a num">${km(o.d)} ${S.modalita==="percorso"?"dal percorso":"in linea d'aria"} · ${p.litri} ${PESO(p.cat)?"kg":"l"} = ${eur(o.pieno)} · spesa vera ${eur(o.tot)}</div>` : "";
  return `<div class="pop"><h4>${esc(nomeSt(st))}</h4><div class="a">${esc(titoloCase(st.n))}<br>${esc(titoloCase(st.i))}, ${esc(titoloCase(st.c))} (${esc(st.p)})${st.a?" · autostrada":""}</div>${extra}<table>${righe}</table><div class="nav">${navHTML(st)}</div></div>`;
}
function evidenzia(id, apri){
  SCELTO = id;
  document.querySelectorAll(".card").forEach(c => { if (+c.dataset.id === id) c.setAttribute("aria-current","true"); else c.removeAttribute("aria-current"); });
  const c = document.querySelector(`.card[data-id="${id}"]`);
  if (!apri && c) c.scrollIntoView({block:"nearest", behavior:"smooth"});
  const m = markers.get(id);
  if (apri && m && map){ map.setView(m.getLatLng(), Math.max(map.getZoom(), 13)); m.openPopup(); }
}
function restilizza(){ if (!map) return; disegnaBase(); disegnaMappa(ULTIMI); }

// ---------- comuni ----------
const norm = s => s.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
let COMUNI_N = [];
function cercaComune(q){
  const n = norm(q); if (n.length < 2) return [];
  const inizio = [], dentro = [];
  for (let i=0;i<COMUNI.length;i++){ const s = COMUNI_N[i]; if (s.startsWith(n)) inizio.push(COMUNI[i]); else if (s.includes(" "+n) || (n.length>3 && s.includes(n))) dentro.push(COMUNI[i]); if (inizio.length>60) break; }
  const A = S.partenza, vic = c => A ? dist(A.lat,A.lon,c[2],c[3]) : 0;
  const esatti = inizio.filter((c,i) => norm(c[0]) === n);
  inizio.sort((x,y) => vic(x)-vic(y)); dentro.sort((x,y) => vic(x)-vic(y));
  return [...new Set(esatti.concat(inizio, dentro))].slice(0, 10);
}
function vicinoComune(lat, lon){ let b=null, bd=1e9; for (const c of COMUNI){ const d=dist(lat,lon,c[2],c[3]); if (d<bd){bd=d;b=c;} } return b; }
function collegaRicerca(inp, box, scegli){
  let att = -1;
  const mostra = () => {
    const r = cercaComune(inp.value);
    if (!r.length){ box.hidden = true; return; }
    box.innerHTML = r.map((c,i) => `<button type="button" data-i="${i}">${esc(c[0])} <span class="hint">(${esc(c[1])})</span></button>`).join("");
    box.hidden = false; att = -1;
    box.querySelectorAll("button").forEach(b => b.addEventListener("mousedown", e => { e.preventDefault(); scegli(r[+b.dataset.i]); box.hidden = true; }));
  };
  inp.addEventListener("input", mostra);
  inp.addEventListener("focus", () => { inp.select(); });
  inp.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
  inp.addEventListener("keydown", e => {
    const bs = [...box.querySelectorAll("button")];
    if (e.key === "ArrowDown" && bs.length){ e.preventDefault(); att=(att+1)%bs.length; bs[att].focus(); }
    if (e.key === "Enter"){ e.preventDefault(); const r = cercaComune(inp.value); if (r[0]){ scegli(r[0]); box.hidden = true; } }
  });
  box.addEventListener("keydown", e => {
    const bs = [...box.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown"){ e.preventDefault(); bs[(i+1)%bs.length].focus(); }
    if (e.key === "ArrowUp"){ e.preventDefault(); if (i<=0) inp.focus(); else bs[i-1].focus(); }
    if (e.key === "Enter" && i>=0){ e.preventDefault(); bs[i].dispatchEvent(new MouseEvent("mousedown")); inp.blur(); }
  });
}

// ---------- modulo ----------
function premi(gruppo, v, attr){ document.querySelectorAll(gruppo+" button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === v))); }
function sincronizzaForm(){
  const p = prof();
  $("#profili").innerHTML = S.profili.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id===p.id}">${esc(x.nome)}</button>`).join("");
  premi("#carburanti", p.cat, "cat"); premi("#servizio", p.servizio, "v"); premi("#modalita", S.modalita, "v"); premi("#ordine", S.ordine, "v");
  $("#litri").value = p.litri; $("#consumo").value = p.consumo; $("#premium").checked = !!p.premium;
  $("#u-litri").textContent = PESO(p.cat) ? "kg" : "litri"; $("#u-consumo").textContent = PESO(p.cat) ? "km/kg" : "km/l";
  $("#premium").closest("label").hidden = !(p.cat === "B" || p.cat === "G");
  $("#nome-profilo").value = p.nome; $("#btn-profilo-elimina").hidden = S.profili.length < 2;
  $("#partenza").value = S.partenza ? S.partenza.nome : "";
  $("#arrivo").value = S.arrivo ? S.arrivo.nome : "";
  $("#box-arrivo").hidden = S.modalita !== "percorso";
  $("#lbl-partenza").textContent = S.modalita === "percorso" ? "Parto da" : "Sono a";
  $("#lbl-raggio").textContent = S.modalita === "percorso" ? "Lontano dal percorso al massimo" : "Al massimo a";
  $("#raggio").value = S.modalita === "percorso" ? S.corridoio : S.raggio;
  $("#raggio").max = S.modalita === "percorso" ? 15 : 60;
  $("#giorni").value = S.giorni; $("#no-autostrada").checked = S.noAutostrada; $("#escludi").value = S.escludi;
  $("#spiega").textContent = S.modalita === "percorso"
    ? "La spesa vera somma il rifornimento e il carburante della deviazione dal percorso (andata e ritorno). Il percorso è disegnato in linea retta."
    : "La spesa vera somma il rifornimento e il carburante che bruci per arrivare al distributore e tornare indietro.";
  const h = $("#maphint");
  if (S.modalita === "percorso" && !S.arrivo){ h.hidden = false; h.textContent = "Scrivi dove vai, oppure tocca la mappa e scegli «Vado qui»."; } else h.hidden = true;
}
let tCalc;
function cambia(inquadraAnche){ salva(); sincronizzaForm(); clearTimeout(tCalc); tCalc = setTimeout(() => { if (inquadraAnche) inquadra(); calcola(); }, 120); }
function num(el, lo, hi, def){ const v = parseFloat(String(el.value).replace(",", ".")); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; }

function collega(){
  $("#profili").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.attivo = b.dataset.id; cambia(); });
  $("#btn-profilo-nuovo").addEventListener("click", () => {
    const id = "p"+Date.now().toString(36); const base = prof();
    S.profili.push({id, nome:"Veicolo "+(S.profili.length+1), cat:base.cat, servizio:"self", litri:40, consumo:15, premium:false});
    S.attivo = id; cambia(); const d = $("details.more"); d.open = true; $("#nome-profilo").focus();
  });
  $("#btn-profilo-elimina").addEventListener("click", () => { if (S.profili.length < 2) return; S.profili = S.profili.filter(p => p.id !== S.attivo); S.attivo = S.profili[0].id; cambia(); });
  $("#nome-profilo").addEventListener("change", e => { prof().nome = e.target.value.trim() || "Veicolo"; cambia(); });
  $("#carburanti").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; prof().cat = b.dataset.cat; cambia(); });
  $("#servizio").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; prof().servizio = b.dataset.v; cambia(); });
  $("#modalita").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.modalita = b.dataset.v; cambia(true); });
  $("#ordine").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.ordine = b.dataset.v; salva(); sincronizzaForm(); disegnaRisultati(ordina(ULTIMI)); });
  $("#litri").addEventListener("change", e => { prof().litri = num(e.target, 1, 500, 40); cambia(); });
  $("#consumo").addEventListener("change", e => { prof().consumo = num(e.target, 1, 80, 15); cambia(); });
  $("#premium").addEventListener("change", e => { prof().premium = e.target.checked; cambia(); });
  $("#raggio").addEventListener("change", e => { if (S.modalita === "percorso") S.corridoio = num(e.target, 0.5, 15, 3); else S.raggio = num(e.target, 1, 60, 10); cambia(true); });
  $("#giorni").addEventListener("change", e => { S.giorni = Math.round(num(e.target, 1, 60, 7)); cambia(); });
  $("#no-autostrada").addEventListener("change", e => { S.noAutostrada = e.target.checked; cambia(); });
  $("#escludi").addEventListener("change", e => { S.escludi = e.target.value; cambia(); });
  collegaRicerca($("#partenza"), $("#sugg-partenza"), c => { S.partenza = {nome:c[0]+" ("+c[1]+")", lat:c[2], lon:c[3]}; cambia(true); });
  collegaRicerca($("#arrivo"), $("#sugg-arrivo"), c => { S.arrivo = {nome:c[0]+" ("+c[1]+")", lat:c[2], lon:c[3]}; cambia(true); });
  $("#btn-gps").addEventListener("click", usaGPS);
  $("#lista").addEventListener("click", e => { const c = e.target.closest(".card"); if (c) evidenzia(+c.dataset.id, true); });
  const mq = matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", restilizza);
  new MutationObserver(restilizza).observe(document.documentElement, {attributes:true, attributeFilter:["data-theme"]});
}

// ---------- posizione dal telefono ----------
function usaGPS(){
  const bt = $("#btn-gps");
  if (!navigator.geolocation){ bt.textContent = "Posizione non disponibile"; return; }
  bt.disabled = true; bt.textContent = "Cerco la posizione…";
  navigator.geolocation.getCurrentPosition(p => {
    const lat = +p.coords.latitude.toFixed(5), lon = +p.coords.longitude.toFixed(5), c = COMUNI.length ? vicinoComune(lat, lon) : null;
    S.partenza = {nome: "La mia posizione" + (c ? " ("+c[0]+")" : ""), lat, lon};
    bt.disabled = false; bt.textContent = "📍 Usa la mia posizione";
    cambia(true);
  }, err => {
    bt.disabled = false;
    bt.textContent = err.code === 1 ? "Permesso negato: attivalo nelle impostazioni" : "Posizione non trovata, riprova";
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:60000});
}

// ---------- avvio ----------
function statoChip(){
  const est = new Date(IND.estrazione+"T12:00:00");
  const oggi = new Date(); oggi.setHours(12,0,0,0);
  const giorni = Math.round((oggi - est)/86400000);
  const vecchio = giorni > 2;
  $("#stato").innerHTML = `<span class="chip ${vecchio?"vecchio":""}"><span class="dot"></span>Dati del Ministero, estrazione del ${dataIT(est)}</span><span class="chip num">${IND.distributori.toLocaleString("it-IT")} distributori</span>` +
    (vecchio ? `<span class="chip vecchio"><span class="dot"></span>L'aggiornamento di oggi non è ancora arrivato</span>` : "");
}
async function avvia(){
  collega(); sincronizzaForm(); iniziaMappa();
  try {
    if (IN_APP){
      try {
        const r = await fetch(REMOTO+"dati/indice.json?t="+Date.now(), {cache:"no-store"});
        const loc = await fetch("dati/indice.json").then(x => x.json()).catch(() => null);
        if (r.ok){ const rem = await r.json(); if (!loc || rem.estrazione >= loc.estrazione) BASE_DATI = REMOTO; }
      } catch(e){}
    }
    const [ind, com, sto] = await Promise.all([caricaJSON("dati/indice.json"), caricaJSON("base/comuni.json"), caricaJSON("dati/storico.json").catch(()=>[])]);
    IND = ind; COMUNI = com; STORICO = sto; COMUNI_N = COMUNI.map(c => norm(c[0]));
    estrDate = new Date(IND.estrazione+"T23:59:00");
    statoChip();
  } catch(e){
    $("#stato").innerHTML = `<span class="chip errore"><span class="dot"></span>Prezzi non caricati: ricarica la pagina</span>`;
    $("#lista").innerHTML = `<div class="empty">I prezzi non si sono caricati (${esc(e.message)}). Controlla la connessione e ricarica.</div>`;
    return;
  }
  disegnaBase(); inquadra(); aggiornaComuni(); calcola();
}
avvia();
if (!IN_APP && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
