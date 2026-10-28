# Carburante Giusto

App per telefono (e PC) con i prezzi ufficiali dei distributori italiani e il distributore più conveniente per il tuo veicolo.

- **Prezzi**: open data del Ministero delle Imprese e del Made in Italy, Osservaprezzi carburanti (licenza IODL 2.0). Aggiornati ogni giorno in automatico da GitHub Actions (`.github/workflows/prezzi.yml`).
- **Mappa**: © OpenStreetMap. Navigazione con Google Maps, Waze o Mappe Apple.
- **Il più conveniente**: «spesa vera» = rifornimento + carburante per arrivare al distributore e tornare.

## Installare sul telefono
- **Android (Chrome)**: apri il sito → menu ⋮ → **Installa app** (o «Aggiungi a schermata Home»).
- **iPhone (Safari)**: apri il sito → tasto Condividi → **Aggiungi alla schermata Home**.

## Attivare il sito (una volta sola)
Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, cartella `/ (root)` → Save.
Poi Actions → «Prezzi del giorno» → *Run workflow* per provare subito l'aggiornamento.

## File
- `index.html` app intera; `leaflet.js` mappa; `sw.js` funzionamento senza rete; `manifest.webmanifest` e `icone/` installazione.
- `aggiorna_dati.py` trasforma i CSV del Ministero in `dati/` (tessere da 1 grado, medie, storico).
- Sorgenti della pagina: `stile.css`, `body.html`, `app.js`, `build.py` (rigenera `index.html`).
