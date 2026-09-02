import React, { useState, useCallback, useEffect, useRef } from "react";
import html2canvas from "html2canvas";
import {
  Fish,
  Anchor,
  Waves,
  Sunrise,
  Sunset,
  SlidersHorizontal,
  MapPin,
  Search,
  KeyRound,
  Loader2,
  AlertTriangle,
  Gauge,
  RotateCcw,
  Share2,
} from "lucide-react";

const FREE_PLAN_CREDITS = 50;
const SAVED_KEYS_STORAGE = "barometre_saved_api_keys";

/* ------------------------------------------------------------------ */
/* Répertoire de clés API — stocké en localStorage (privé au navigateur) */
/* ------------------------------------------------------------------ */

function loadSavedKeys() {
  try {
    const raw = window.localStorage.getItem(SAVED_KEYS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedKeys(keys) {
  try {
    window.localStorage.setItem(SAVED_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    /* stockage indisponible (ex. navigation privée) — on ignore silencieusement */
  }
}


/* ------------------------------------------------------------------ */
/* Capture d'un élément DOM en image PNG + partage natif (ou téléchargement) */
/* ------------------------------------------------------------------ */

async function captureAndShare(node, filename) {
  if (!node) return;
  const canvas = await html2canvas(node, {
    backgroundColor: "#0E2233",
    scale: 2,
    useCORS: true,
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;

  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "BarOmètre", text: "Programme de pêche 🎣" });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // partage annulé par l'utilisateur, rien à faire
      // sinon on retombe sur le téléchargement classique ci-dessous
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Petit hash pour identifier une clé API sans la stocker en clair */
function shortKeyId(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ------------------------------------------------------------------ */
/* Conversion heure "HH:MM" -> minutes depuis minuit                   */
/* ------------------------------------------------------------------ */

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/* ------------------------------------------------------------------ */
/* Appel API TidesAtlas — https://tidesatlas.com/en/api/docs           */
/* ------------------------------------------------------------------ */

const TIDESATLAS_BASE = "https://tidesatlas.com/api/v1";

const FR_WEEKDAYS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];
const FR_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function frenchLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${FR_WEEKDAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) + 1;
}

async function searchPorts(apiKey, query) {
  const res = await fetch(`${TIDESATLAS_BASE}/ports?search=${encodeURIComponent(query)}&limit=8`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Recherche de port : erreur ${res.status}`);
  const data = await res.json();
  return data.ports || data.results || [];
}

async function fetchTidesRange(apiKey, portSlug, startDate, endDate) {
  const totalDays = diffDays(startDate, endDate);
  const chunks = [];
  let cursor = startDate;
  let remaining = totalDays;
  while (remaining > 0) {
    const chunkDays = Math.min(14, remaining);
    chunks.push({ date: cursor, days: chunkDays });
    cursor = addDays(cursor, chunkDays);
    remaining -= chunkDays;
  }

  const byDate = {};
  const coefByDate = {};

  for (const chunk of chunks) {
    const url = `${TIDESATLAS_BASE}/tides?port=${encodeURIComponent(portSlug)}&date=${chunk.date}&days=${chunk.days}`;
    const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Limite de requêtes atteinte (429). Réessaie plus tard ou augmente ton palier.");
      if (res.status === 401 || res.status === 403) throw new Error("Clé API invalide ou refusée (401/403). Vérifie ta clé.");
      throw new Error(`Erreur API TidesAtlas (${res.status})`);
    }
    const data = await res.json();

    (data.coefficients?.daily || []).forEach((d) => {
      coefByDate[d.date] = d;
    });

    (data.extremes || []).forEach((ex) => {
      const [datePart, timePart] = ex.datetime.split("T");
      const hhmm = timePart.slice(0, 5);
      if (!byDate[datePart]) byDate[datePart] = [];
      byDate[datePart].push({
        time: toMin(hhmm),
        hhmm,
        type: ex.type === "high" ? "PM" : "BM",
        height: ex.height_m,
        coef: ex.coefficient ?? null,
      });
    });
  }

  return Object.keys(byDate)
    .sort()
    .map((date) => {
      const events = byDate[date].sort((a, b) => a.time - b.time);
      const daily = coefByDate[date];
      // Complète le coefficient des basses mers avec la moyenne matin/aprèm du jour, si connue
      events.forEach((e) => {
        if (e.coef == null && daily) {
          e.coef = e.time < 12 * 60 ? daily.morning ?? daily.max : daily.afternoon ?? daily.max;
        }
      });
      return { date, label: frenchLabel(date), events };
    });
}

/* ------------------------------------------------------------------ */
/* Fenêtres de pêche : ±60 min autour de chaque étale                  */
/* ------------------------------------------------------------------ */

function buildWindows(day) {
  return day.events.map((e) => ({
    ...e,
    start: e.time - 180,
    end: e.time + 60,
    slot: e.time < 12 * 60 ? "matin" : "soir",
  }));
}

const fmt = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}h${String(mm).padStart(2, "0")}`;
};

function quality(coef) {
  if (coef == null) return 1;
  if (coef >= 110) return 5;
  if (coef >= 95) return 4;
  if (coef >= 70) return 3;
  if (coef >= 45) return 2;
  return 1;
}

/* ------------------------------------------------------------------ */
/* Courbe de marée (interpolation cosinus entre étales)                */
/* ------------------------------------------------------------------ */

function tideCurvePath(events, width, height, padding, yMax) {
  const pts = [];
  const step = 10;
  for (let t = 0; t <= 1440; t += step) {
    let h1 = events[0],
      h2 = events[events.length - 1];
    for (let i = 0; i < events.length - 1; i++) {
      if (t >= events[i].time && t <= events[i + 1].time) {
        h1 = events[i];
        h2 = events[i + 1];
        break;
      }
    }
    let val;
    if (t <= events[0].time) val = events[0].height;
    else if (t >= events[events.length - 1].time) val = events[events.length - 1].height;
    else {
      const frac = (t - h1.time) / (h2.time - h1.time);
      val = h1.height + (h2.height - h1.height) * (1 - Math.cos(Math.PI * frac)) / 2;
    }
    const x = padding + (t / 1440) * (width - 2 * padding);
    const y = padding + (1 - val / yMax) * (height - 2 * padding);
    pts.push([x, y]);
  }
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

/* ------------------------------------------------------------------ */
/* Carte d'un jour                                                      */
/* ------------------------------------------------------------------ */

function DayCard({ day, filter, minCoef, cardRef, onShare, sharing }) {
  const windows = buildWindows(day).filter((w) => (w.coef == null ? true : w.coef >= minCoef));
  const visible = windows.filter((w) => filter === "tous" || w.slot === filter);
  if (visible.length === 0) return null;

  const width = 320,
    height = 90,
    padding = 8,
    yMax = 5.8;
  const path = tideCurvePath(day.events, width, height, padding, yMax);
  const bestCoef = Math.max(0, ...day.events.map((e) => e.coef || 0));

  return (
    <div
      ref={cardRef}
      style={{
        background: "var(--paper)",
        border: "1px solid rgba(20,40,50,0.14)",
        borderRadius: 10,
        padding: "18px 20px 16px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>
          {day.label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {bestCoef > 0 && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                color: bestCoef >= 95 ? "var(--brass)" : "var(--muted)",
                fontWeight: 600,
              }}
            >
              coef. max {bestCoef}
            </span>
          )}
          {onShare && (
            <button
              onClick={onShare}
              disabled={sharing}
              title="Partager cette journée en image"
              data-html2canvas-ignore="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 6,
                border: "1px solid rgba(20,40,50,0.18)",
                background: "transparent",
                color: "var(--ink)",
                cursor: sharing ? "wait" : "pointer",
                opacity: sharing ? 0.5 : 0.75,
                flexShrink: 0,
              }}
            >
              {sharing ? <Loader2 size={13} className="spin" /> : <Share2 size={13} />}
            </button>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
        {visible.map((w, i) => {
          const x1 = padding + (Math.max(0, w.start) / 1440) * (width - 2 * padding);
          const x2 = padding + (Math.min(1440, w.end) / 1440) * (width - 2 * padding);
          return (
            <rect
              key={i}
              x={x1}
              y={0}
              width={Math.max(2, x2 - x1)}
              height={height}
              fill={w.type === "PM" ? "rgba(201,138,61,0.22)" : "rgba(47,107,128,0.22)"}
            />
          );
        })}
        <path d={path} fill="none" stroke="var(--tide-line)" strokeWidth="2" />
      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {visible.map((w, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--ink)",
              color: "var(--paper)",
              borderRadius: 7,
              padding: "6px 10px",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12.5,
            }}
          >
            {w.slot === "matin" ? <Sunrise size={13} /> : <Sunset size={13} />}
            <span>{fmt(w.start)}–{fmt(w.end)}</span>
            <span style={{ opacity: 0.55 }}>
              {w.type === "PM" ? "▲PM" : "▼BM"} {w.height.toFixed(2)}m
            </span>
            <span style={{ color: "var(--brass)", letterSpacing: "1px" }}>
              {"★".repeat(quality(w.coef))}
              <span style={{ opacity: 0.25 }}>{"★".repeat(5 - quality(w.coef))}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

export default function BarOmetre() {
  const [apiKey, setApiKey] = useState("");
  const [savedKeys, setSavedKeys] = useState([]);
  const [selectedSavedKeyId, setSelectedSavedKeyId] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");

  useEffect(() => {
    setSavedKeys(loadSavedKeys());
  }, []);

  const handleSelectSavedKey = useCallback(
    (id) => {
      setSelectedSavedKeyId(id);
      const found = savedKeys.find((k) => k.id === id);
      if (found) setApiKey(found.key);
    },
    [savedKeys]
  );

  const handleSaveCurrentKey = useCallback(() => {
    if (!apiKey.trim()) return;
    const label = newKeyLabel.trim() || `Clé ${savedKeys.length + 1}`;
    const entry = { id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()), label, key: apiKey.trim() };
    const next = [...savedKeys, entry];
    setSavedKeys(next);
    persistSavedKeys(next);
    setSelectedSavedKeyId(entry.id);
    setNewKeyLabel("");
  }, [apiKey, newKeyLabel, savedKeys]);

  const handleDeleteSavedKey = useCallback(
    (id) => {
      const next = savedKeys.filter((k) => k.id !== id);
      setSavedKeys(next);
      persistSavedKeys(next);
      if (selectedSavedKeyId === id) setSelectedSavedKeyId("");
    },
    [savedKeys, selectedSavedKeyId]
  );

  const [portQuery, setPortQuery] = useState("le pouldu");
  const [portResults, setPortResults] = useState([]);
  const [selectedPort, setSelectedPort] = useState(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveDays, setLiveDays] = useState(null);

  const [start, setStart] = useState("2026-08-02");
  const [end, setEnd] = useState("2026-08-22");
  const [filter, setFilter] = useState("tous");
  const [minCoef, setMinCoef] = useState(0);

  const [creditsUsed, setCreditsUsed] = useState(0);
  const [creditsLoaded, setCreditsLoaded] = useState(false);

  const cardRefs = useRef({});
  const mainRef = useRef(null);
  const [sharingId, setSharingId] = useState(null);
  const [sharingAll, setSharingAll] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleShareCard = useCallback(async (day) => {
    setSharingId(day.date);
    try {
      await captureAndShare(cardRefs.current[day.date], `barometre-${day.date}.png`);
    } catch (e) {
      setError("Impossible de générer l'image de partage.");
    } finally {
      setSharingId(null);
    }
  }, []);

  const handleShareAll = useCallback(async () => {
    setSharingAll(true);
    try {
      await captureAndShare(mainRef.current, `barometre-${start}_${end}.png`);
    } catch (e) {
      setError("Impossible de générer l'image de partage.");
    } finally {
      setSharingAll(false);
    }
  }, [start, end]);

  const storageKey = apiKey ? `tidesatlas-credits:${shortKeyId(apiKey)}` : null;

  // Charge le compteur de crédits associé à cette clé depuis le stockage persistant
  useEffect(() => {
    let cancelled = false;
    if (!storageKey) {
      setCreditsUsed(0);
      setCreditsLoaded(false);
      return;
    }
    setCreditsLoaded(false);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!cancelled) setCreditsUsed(raw ? Number(raw) || 0 : 0);
    } catch {
      if (!cancelled) setCreditsUsed(0);
    } finally {
      if (!cancelled) setCreditsLoaded(true);
    }
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const bumpCredits = useCallback(
    async (n) => {
      if (!storageKey) return;
      setCreditsUsed((prev) => {
        const next = prev + n;
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch {
          /* ignore (stockage indisponible, ex. navigation privée) */
        }
        return next;
      });
    },
    [storageKey]
  );

  const handleResetCredits = useCallback(async () => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, "0");
    } catch {
      /* ignore */
    }
    setCreditsUsed(0);
  }, [storageKey]);

  const handleSearchPorts = useCallback(async () => {
    setError("");
    setSearching(true);
    try {
      const results = await searchPorts(apiKey, portQuery);
      setPortResults(results);
      await bumpCredits(1);
    } catch (e) {
      setError(e.message || "Impossible de rechercher un port (bloqué par CORS ou clé invalide ?)");
    } finally {
      setSearching(false);
    }
  }, [apiKey, portQuery, bumpCredits]);

  const handleFetchTides = useCallback(async () => {
    if (!selectedPort) {
      setError("Choisis d'abord un port dans les résultats de recherche.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const days = await fetchTidesRange(apiKey, selectedPort.slug, start, end);
      setLiveDays(days);
      const callsUsed = Math.ceil(diffDays(start, end) / 14);
      await bumpCredits(callsUsed);
    } catch (e) {
      setError(e.message || "Échec de la requête (possible blocage CORS depuis le navigateur).");
    } finally {
      setLoading(false);
    }
  }, [apiKey, selectedPort, start, end, bumpCredits]);

  const daysToShow = liveDays || [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--ink)", fontFamily: "'IBM Plex Sans', sans-serif", color: "var(--paper)", padding: "0 0 60px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        :root {
          --ink: #0E2233;
          --paper: #EDE6D6;
          --paper-dim: #DBD2BB;
          --brass: #C98A3D;
          --tide-line: #2F6B80;
          --muted: #6E7C82;
        }
        input[type="date"] { color-scheme: dark; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>

      <header style={{ padding: "36px 24px 22px", borderBottom: "1px solid rgba(237,230,214,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Fish size={22} color="var(--brass)" />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "2px", color: "var(--brass)", textTransform: "uppercase" }}>
              BarOmètre
            </span>
          </div>
          <button
            onClick={() => setShowHelp((v) => !v)}
            title="Comment ça marche ?"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "1px solid rgba(237,230,214,0.35)",
              background: showHelp ? "var(--brass)" : "transparent",
              color: showHelp ? "var(--ink)" : "var(--paper)",
              fontFamily: "'Fraunces', serif",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ?
          </button>
        </div>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 700, margin: "0 0 8px", lineHeight: 1.1 }}>
          Fenêtres de bar, du courant à la ligne
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.7, fontSize: 14 }}>
          <MapPin size={14} />
          <span>{selectedPort ? selectedPort.name : "aucun port choisi pour l'instant"}</span>
        </div>
      </header>

      {showHelp && (
        <section
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(237,230,214,0.12)",
            background: "rgba(237,230,214,0.04)",
          }}
        >
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: "0 0 10px" }}>
            Comment ça marche
          </h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.5, opacity: 0.9 }}>
            <li>
              <strong>Colle ta clé API TidesAtlas</strong> (gratuite sur tidesatlas.com, 50 crédits offerts), ou choisis-en
              une déjà enregistrée dans le menu déroulant.
            </li>
            <li>
              <strong>Cherche un port</strong> par son nom, puis clique sur celui qui t'intéresse dans les résultats.
            </li>
            <li>
              <strong>Choisis tes dates</strong> (Du / Au), puis clique sur <em>"Charger les marées"</em>.
            </li>
            <li>
              Chaque carte affiche les <strong>fenêtres de pêche</strong> (3h avant à 1h après chaque étale, matin
              comme soir), avec une note de <strong>1 à 5 ★</strong> basée sur le coefficient de marée — plus il est
              élevé, plus le courant est fort.
            </li>
            <li>
              Filtre par <strong>matin / soir</strong>, ajuste le <strong>coefficient minimum</strong>, et partage une
              carte ou toute la période en image (icône <Share2 size={12} style={{ display: "inline", verticalAlign: "-1px" }} />) — pratique pour l'envoyer à tes potes de pêche sur WhatsApp.
            </li>
          </ol>
        </section>
      )}

      {/* Panneau connexion API */}
      <section style={{ padding: "20px 24px", borderBottom: "1px solid rgba(237,230,214,0.12)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, opacity: 0.85 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <KeyRound size={12} /> Clé API TidesAtlas
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSelectedSavedKeyId("");
              }}
              placeholder="Colle ta clé (tidesatlas.com — gratuit, 50 crédits)"
              style={{ background: "transparent", border: "1px solid rgba(237,230,214,0.35)", borderRadius: 6, padding: "8px 10px", color: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}
            />
          </label>

            {savedKeys.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={selectedSavedKeyId}
                  onChange={(e) => handleSelectSavedKey(e.target.value)}
                  style={{
                    flex: 1,
                    background: "var(--ink)",
                    border: "1px solid rgba(237,230,214,0.35)",
                    borderRadius: 6,
                    padding: "7px 9px",
                    color: "var(--paper)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12.5,
                  }}
                >
                  <option value="">— Clés enregistrées —</option>
                  {savedKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
                {selectedSavedKeyId && (
                  <button
                    onClick={() => handleDeleteSavedKey(selectedSavedKeyId)}
                    title="Supprimer cette clé enregistrée"
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(237,230,214,0.3)",
                      borderRadius: 6,
                      padding: "6px 9px",
                      color: "var(--paper)",
                      fontSize: 12,
                      cursor: "pointer",
                      opacity: 0.75,
                    }}
                  >
                    Suppr.
                  </button>
                )}
              </div>
            )}

            {apiKey && !selectedSavedKeyId && (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="Nom pour cette clé (ex. Mon compte perso)"
                  style={{ flex: 1, background: "transparent", border: "1px solid rgba(237,230,214,0.35)", borderRadius: 6, padding: "7px 9px", color: "var(--paper)", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5 }}
                />
                <button
                  onClick={handleSaveCurrentKey}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "7px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--brass)",
                    color: "var(--ink)",
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Mémoriser
                </button>
              </div>
            )}

            {apiKey && creditsLoaded && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  background: "rgba(237,230,214,0.06)",
                  border: "1px solid rgba(237,230,214,0.18)",
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>
                  <Gauge
                    size={14}
                    color={
                      FREE_PLAN_CREDITS - creditsUsed <= 5
                        ? "#E0654A"
                        : FREE_PLAN_CREDITS - creditsUsed <= 15
                        ? "#E8A94A"
                        : "var(--brass)"
                    }
                  />
                  <span>
                    {Math.max(0, FREE_PLAN_CREDITS - creditsUsed)}/{FREE_PLAN_CREDITS} crédits restants
                  </span>
                  {creditsUsed >= FREE_PLAN_CREDITS && (
                    <span style={{ color: "#E0654A" }}>· épuisés</span>
                  )}
                </div>
                <button
                  onClick={handleResetCredits}
                  title="Remets le compteur à zéro si tu as créé un nouveau compte TidesAtlas"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    background: "transparent",
                    border: "1px solid rgba(237,230,214,0.3)",
                    borderRadius: 6,
                    padding: "4px 8px",
                    color: "var(--paper)",
                    fontSize: 11.5,
                    fontFamily: "'IBM Plex Mono', monospace",
                    cursor: "pointer",
                    opacity: 0.8,
                  }}
                >
                  <RotateCcw size={11} /> Nouveau compte
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={portQuery}
                onChange={(e) => setPortQuery(e.target.value)}
                placeholder="Rechercher un port (ex. le pouldu, quiberon...)"
                style={{ flex: 1, background: "transparent", border: "1px solid rgba(237,230,214,0.35)", borderRadius: 6, padding: "8px 10px", color: "var(--paper)", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}
              />
              <button
                onClick={handleSearchPorts}
                disabled={!apiKey || searching}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 6, border: "none", background: "var(--brass)", color: "var(--ink)", fontWeight: 600, fontSize: 13, cursor: apiKey ? "pointer" : "not-allowed", opacity: apiKey ? 1 : 0.5 }}
              >
                {searching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
                Chercher
              </button>
            </div>

            {portResults.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {portResults.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => setSelectedPort(p)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 20,
                      border: "1px solid rgba(237,230,214,0.35)",
                      background: selectedPort?.slug === p.slug ? "var(--brass)" : "transparent",
                      color: selectedPort?.slug === p.slug ? "var(--ink)" : "var(--paper)",
                      fontSize: 12,
                      fontFamily: "'IBM Plex Mono', monospace",
                      cursor: "pointer",
                    }}
                  >
                    {p.name}{p.country ? ` · ${p.country}` : ""}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, opacity: 0.85 }}>
                Du
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ background: "transparent", border: "1px solid rgba(237,230,214,0.35)", borderRadius: 6, padding: "6px 8px", color: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, opacity: 0.85 }}>
                Au
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ background: "transparent", border: "1px solid rgba(237,230,214,0.35)", borderRadius: 6, padding: "6px 8px", color: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace" }} />
              </label>
            </div>

            <button
              onClick={handleFetchTides}
              disabled={!apiKey || !selectedPort || loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--tide-line)", color: "var(--paper)", fontWeight: 600, fontSize: 13.5, cursor: apiKey && selectedPort ? "pointer" : "not-allowed", opacity: apiKey && selectedPort ? 1 : 0.5 }}
            >
              {loading ? <Loader2 size={15} className="spin" /> : <Waves size={15} />}
              Charger les marées pour la période choisie
            </button>

            {error && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#E8A94A", background: "rgba(232,169,74,0.1)", padding: "8px 10px", borderRadius: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}
          </div>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: "20px 24px", borderBottom: "1px solid rgba(237,230,214,0.12)", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["tous", "matin", "soir"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "7px 13px",
                borderRadius: 20,
                border: "1px solid rgba(237,230,214,0.35)",
                background: filter === f ? "var(--brass)" : "transparent",
                color: filter === f ? "var(--ink)" : "var(--paper)",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {f === "matin" && <Sunrise size={13} />}
              {f === "soir" && <Sunset size={13} />}
              {f === "tous" && <Waves size={13} />}
              {f}
            </button>
          ))}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, opacity: 0.85, minWidth: 200 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <SlidersHorizontal size={12} /> Coefficient min. : {minCoef}
          </span>
          <input type="range" min="0" max="120" step="5" value={minCoef} onChange={(e) => setMinCoef(Number(e.target.value))} />
        </label>

        {daysToShow.length > 0 && (
          <button
            onClick={handleShareAll}
            disabled={sharingAll}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(237,230,214,0.35)",
              background: "transparent",
              color: "var(--paper)",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: sharingAll ? "wait" : "pointer",
              opacity: sharingAll ? 0.6 : 1,
            }}
          >
            {sharingAll ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />}
            Partager toute la période
          </button>
        )}
      </section>

      <main ref={mainRef} style={{ padding: "22px 24px 0", maxWidth: 760, margin: "0 auto" }}>
        {!selectedPort && (
          <div style={{ textAlign: "center", padding: "40px 20px", opacity: 0.75 }}>
            <Fish size={28} color="var(--brass)" style={{ marginBottom: 10 }} />
            <p style={{ margin: 0, fontSize: 14.5 }}>
              Colle ta clé API et cherche un port ci-dessus pour commencer.
              <br />
              <span style={{ fontSize: 12.5, opacity: 0.7 }}>
                (le bouton <strong>?</strong> en haut à droite explique tout le fonctionnement)
              </span>
            </p>
          </div>
        )}
        {selectedPort && !liveDays && !loading && (
          <div style={{ textAlign: "center", padding: "40px 20px", opacity: 0.75 }}>
            <Waves size={28} color="var(--brass)" style={{ marginBottom: 10 }} />
            <p style={{ margin: 0, fontSize: 14.5 }}>
              Port choisi : <strong>{selectedPort.name}</strong>. Clique sur "Charger les marées" pour voir les fenêtres de pêche.
            </p>
          </div>
        )}
        {selectedPort && liveDays && daysToShow.length === 0 && (
          <p style={{ opacity: 0.6, fontStyle: "italic", textAlign: "center" }}>
            Aucune fenêtre ne correspond aux filtres actuels (essaie de baisser le coefficient minimum).
          </p>
        )}
        {daysToShow.length > 0 && (
          <>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                opacity: 0.55,
                textAlign: "center",
                marginBottom: 14,
              }}
            >
              🎣 BarOmètre · {selectedPort.name} · {start} → {end}
            </div>
            {daysToShow.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                filter={filter}
                minCoef={minCoef}
                cardRef={(el) => (cardRefs.current[day.date] = el)}
                onShare={() => handleShareCard(day)}
                sharing={sharingId === day.date}
              />
            ))}
          </>
        )}
      </main>

      <footer style={{ maxWidth: 760, margin: "30px auto 0", padding: "16px 24px 0", borderTop: "1px solid rgba(237,230,214,0.12)", fontSize: 12.5, opacity: 0.55, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Anchor size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>
          Données live via <strong>TidesAtlas</strong> (tidesatlas.com), coefficient français inclus pour les ports de
          France. Prévisions à titre informatif — pas adaptées à la navigation.
        </span>
      </footer>
    </div>
  );
}
