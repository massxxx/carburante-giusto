#!/usr/bin/env python3
"""Prezzi carburante — prepara i dati per l'app.

Uso:  python3 -I aggiorna_dati.py ANAGRAFICA.csv PREZZI.csv CARTELLA_USCITA [storico_precedente.json]

Legge i due file open data del Ministero delle Imprese e del Made in Italy
(Osservaprezzi carburanti):
  anagrafica_impianti_attivi.csv  idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine
  prezzo_alle_8.csv               idImpianto|descCarburante|prezzo|isSelf|dtComu
e scrive in CARTELLA_USCITA:
  dati/indice.json   data di estrazione, nomi dei carburanti, elenco tessere, comuni, medie Italia e provincia
  dati/t/<chiave>.json  distributori di una tessera da 1 grado (circa 110 x 80 km)
  dati/storico.json  medie Italia giorno per giorno (al massimo 400 giorni)
"""
import csv, io, json, math, os, re, sys, statistics
from datetime import datetime, date, timezone

PASSO = 1.0

def categoria(nome):
    n = nome.strip().lower()
    if n == "benzina": return "B"
    if n == "gasolio": return "G"
    if n == "gpl": return "L"
    if n in ("metano", "l-gnc"): return "M"
    if n == "gnl": return "N"
    if "hvo" in n: return "H"
    if "diesel" in n or "gasolio" in n: return "G+"
    return "B+"   # benzine speciali: Blue Super, HiQ Perform+, V-Power, 98/100 ottani, F101...

def leggi(percorso):
    testo = open(percorso, "rb").read().decode("utf-8", errors="replace")
    righe = testo.splitlines()
    estrazione = ""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", righe[0]) if righe else None
    if m: estrazione = m.group(1)
    return estrazione, [r for r in righe[2:] if r.strip()]

def numero(s):
    try: return float(s.replace(",", "."))
    except ValueError: return None

def main():
    f_anag, f_prezzi, uscita = sys.argv[1], sys.argv[2], sys.argv[3]
    storico_vecchio = sys.argv[4] if len(sys.argv) > 4 else None
    est_a, righe_a = leggi(f_anag)
    est_p, righe_p = leggi(f_prezzi)
    estrazione = est_p or est_a

    impianti = {}
    for r in righe_a:
        c = r.split("|")
        if len(c) < 10: continue
        id_, gestore, bandiera, tipo = c[0], c[1], c[2], c[3]
        indirizzo, comune, prov, lat, lon = c[-5], c[-4], c[-3], c[-2], c[-1]
        nome = "|".join(c[4:-5])
        nome = re.sub(r"\s*\|\s*gestori\.prezzibenzina\.it", "", nome).strip()
        la, lo = numero(lat), numero(lon)
        if la is None or lo is None or not (35 < la < 47.2 and 6 < lo < 19): continue
        impianti[id_] = {
            "b": bandiera.strip(), "n": nome, "i": re.sub(r"\s+", " ", indirizzo).strip(),
            "c": comune.strip().upper(), "p": prov.strip().upper(),
            "a": 1 if tipo.strip().lower().startswith("autostrad") else 0,
            "la": round(la, 5), "lo": round(lo, 5), "pr": {},
        }

    nomi = []           # nomi dei carburanti, indice -> nome
    pos_nome = {}
    for r in righe_p:
        c = r.split("|")
        if len(c) < 5: continue
        id_, desc, prezzo, self_, dt = c[0], c[1].strip(), numero(c[2]), c[3].strip(), c[4].strip()
        imp = impianti.get(id_)
        if imp is None or prezzo is None or not (0.5 < prezzo < 4.5): continue
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})\s+(\d{2}):(\d{2})", dt)
        if not m: continue
        quando = int(m.group(3) + m.group(2) + m.group(1) + m.group(4) + m.group(5))  # AAAAMMGGhhmm
        if desc not in pos_nome:
            pos_nome[desc] = len(nomi); nomi.append(desc)
        chiave = (desc, 1 if self_ == "1" else 0)
        vecchio = imp["pr"].get(chiave)
        if vecchio is None or quando > vecchio[2]:
            imp["pr"][chiave] = (round(prezzo, 3), categoria(desc), quando)

    # tessere
    tessere = {}
    comuni = {}
    validi = 0
    data_est = datetime.strptime(estrazione, "%Y-%m-%d").date() if estrazione else date.today()
    medie_raw = {}      # (cat, self) -> [prezzi]
    prov_raw = {}       # (prov, cat, self) -> [prezzi]
    for id_, imp in impianti.items():
        if not imp["pr"]: continue
        validi += 1
        prezzi = []
        for (desc, s), (prezzo, cat, quando) in sorted(imp["pr"].items(), key=lambda x: (x[1][1], x[0][1] == 0, x[1][0])):
            prezzi.append([pos_nome[desc], cat, prezzo, s, quando])
            g = date(quando // 100000000, quando // 1000000 % 100, quando // 10000 % 100)
            if (data_est - g).days <= 8:      # nelle medie solo prezzi confermati nell'ultima settimana
                medie_raw.setdefault((cat, s), []).append(prezzo)
                prov_raw.setdefault((imp["p"], cat, s), []).append(prezzo)
        k = f"{math.floor(imp['la'] / PASSO * 1) }_{math.floor(imp['lo'] / PASSO)}"
        tessere.setdefault(k, []).append([int(id_), imp["b"], imp["n"], imp["i"], imp["c"], imp["p"], imp["a"], imp["la"], imp["lo"], prezzi])
        ck = imp["c"] + "|" + imp["p"]
        co = comuni.setdefault(ck, [0.0, 0.0, 0])
        co[0] += imp["la"]; co[1] += imp["lo"]; co[2] += 1

    def riassunto(v):
        v = sorted(v)
        return {"media": round(sum(v) / len(v), 3), "mediana": round(statistics.median(v), 3), "min": v[0], "max": v[-1], "n": len(v)}

    italia = {}
    for (cat, s), v in medie_raw.items():
        italia.setdefault(cat, {})["self" if s else "servito"] = riassunto(v)
    province = {}
    for (p, cat, s), v in prov_raw.items():
        if cat in ("B", "G", "L", "M", "H"):
            province.setdefault(p, {}).setdefault(cat, {})["self" if s else "servito"] = {"media": round(sum(v) / len(v), 3), "n": len(v)}

    os.makedirs(os.path.join(uscita, "dati", "t"), exist_ok=True)
    for k, lista in tessere.items():
        with open(os.path.join(uscita, "dati", "t", k + ".json"), "w", encoding="utf-8") as f:
            json.dump(lista, f, ensure_ascii=False, separators=(",", ":"))
    indice = {
        "estrazione": estrazione,
        "preparato": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "fonte": "Ministero delle Imprese e del Made in Italy — Osservaprezzi carburanti, open data (licenza IODL 2.0)",
        "passo": PASSO,
        "distributori": validi,
        "nomi": nomi,
        "tessere": sorted(tessere),
        "comuni": sorted([[c.split("|")[0], c.split("|")[1], round(v[0] / v[2], 4), round(v[1] / v[2], 4), v[2]] for c, v in comuni.items()]),
        "italia": italia,
        "province": province,
    }
    with open(os.path.join(uscita, "dati", "indice.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, separators=(",", ":"))

    storico = []
    if storico_vecchio and os.path.exists(storico_vecchio):
        try: storico = json.load(open(storico_vecchio, encoding="utf-8"))
        except Exception: storico = []
    storico = [x for x in storico if x.get("d") != estrazione]
    voce = {"d": estrazione}
    for cat in ("B", "G", "L", "M", "H"):
        if cat in italia:
            voce[cat] = [italia[cat].get("self", {}).get("media"), italia[cat].get("servito", {}).get("media")]
    storico.append(voce)
    storico = sorted(storico, key=lambda x: x["d"])[-400:]
    with open(os.path.join(uscita, "dati", "storico.json"), "w", encoding="utf-8") as f:
        json.dump(storico, f, ensure_ascii=False, separators=(",", ":"))

    print(f"estrazione {estrazione}: {validi} distributori con prezzi, {len(tessere)} tessere, {len(comuni)} comuni")
    for cat in ("B", "G", "L", "M"):
        if cat in italia: print(cat, italia[cat])
    if validi < 15000:
        print("ATTENZIONE: troppo pochi distributori, file incompleti?"); sys.exit(2)

if __name__ == "__main__":
    main()
