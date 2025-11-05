// api/generate.js
export default async function handler(req, res) {
  // --- CORS (permitimos GitHub Pages y cualquier preview) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    // ---------- Utilidades ----------
    const norm = (s) =>
      String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    let NICK_DB = null;
    async function loadNicknames() {
      if (NICK_DB) return NICK_DB;
      // 1) Intento importar el JSON empacado por Vercel
      try {
        const mod = await import("../data/nicknames.json", { assert: { type: "json" } });
        NICK_DB = mod.default || mod;
        return NICK_DB;
      } catch {
        // 2) Fallback: raw de GitHub (por si el import falla en algún entorno)
        const rawUrl =
          "https://raw.githubusercontent.com/loricchio/tags-hl-generator/main/data/nicknames.json";
        const resp = await fetch(rawUrl);
        if (resp.ok) {
          NICK_DB = await resp.json();
          return NICK_DB;
        }
        // 3) Último recurso: base vacía
        NICK_DB = { teams: {}, variants: {} };
        return NICK_DB;
      }
    }

    function lookupNicknames(db, name) {
      const n = norm(name);
      if (!n) return [];
      if (db.teams[n]) return db.teams[n];
      const via = db.variants?.[n];
      if (via && db.teams[via]) return db.teams[via];
      return [];
    }

    function uniqTags(list) {
      const seen = new Set();
      const out = [];
      for (const t of list) {
        const tag = String(t || "").trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        if (tag.length > 60) continue;
        seen.add(key);
        out.push(tag);
      }
      return { out, seen };
    }

    function joinWithinLimit(tags, maxLen) {
      const out = [];
      for (const t of tags) {
        const probe = out.length ? out.join(", ") + ", " + t : t;
        if (probe.length <= maxLen) out.push(t);
        else break;
      }
      return out.join(", ");
    }

    // ---------- Body seguro ----------
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }

    const {
      competition = "",
      homeTeam = "",
      awayTeam = "",
      homeScore = 0,
      awayScore = 0,
      scorers = [],
      lang = "es",
      maxLen = 500,
      matchDate = "",
      contextNotes = ""
    } = body;

    const scorersText = Array.isArray(scorers) ? scorers.join(", ") : String(scorers || "");

    // ---------- Nicknames ----------
    const db = await loadNicknames();
    const homeNicks = lookupNicknames(db, homeTeam);
    const awayNicks = lookupNicknames(db, awayTeam);

    // ---------- Prompt ----------
    const rules = `
- Idioma base: Español, pero incluir SIEMPRE etiquetas útiles en inglés: "highlights" y 2–3 entre "goals", "recap", "best moments", "extended highlights".
- NO inventar años/fechas/temporadas. SOLO incluir si viene explícito en 'matchDate'.
- Incluir sinónimos de competencia si aplica (p. ej. LaLiga, Liga española, Primera División de España) pero solo cuando correspondan con "${competition}".
- Equipos: agregar variantes canónicas SOLO si corresponden (sin inventar). Si los nombres reales no coinciden, omitir.
- Cruces: "X vs Y" y "Y vs X". Incluir marcador exacto.
- Goleadores: por cada uno, incluir al menos dos variantes (nombre completo y apellido) y 1 tag de acción: "gol de <Apellido>".
- Evitar relleno/marketing: NO "emoción en el campo", NO "espectáculo futbolístico", NO "partido completo".
- Sin duplicados (case-insensitive). Sin '#'. Cada tag ≤ 60 caracteres.
- Si 'contextNotes' viene con algo puntual (ej. "doblete de X", "derbi", "UCL group stage"), incluir 1–3 tags de eso, sin inventar.
- Objetivo: entre 20 y 28 tags útiles. Devolver SOLO la lista, separada por comas, sin texto adicional.
- Si se proveen apodos (whitelist), usarlos tal cual. NO inventar apodos no listados.
`.trim();

    const userBlock = `
Datos:
- Competencia: ${competition}
- Local: ${homeTeam}
- Visitante: ${awayTeam}
- Resultado: ${homeScore}-${awayScore}
- Goleadores: ${scorersText}
- matchDate (opcional): ${matchDate || "(no provista)"}
- contextNotes (opcionales): ${contextNotes || "(sin contexto adicional)"}
- apodos_local (whitelist): ${homeNicks.join(", ") || "(sin apodos)"}
- apodos_visitante (whitelist): ${awayNicks.join(", ") || "(sin apodos)"}
- Límite total de caracteres: ${maxLen}
`.trim();

    const payload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Sos un generador de tags deportivos para YouTube: preciso, específico y sin relleno." },
        { role: "user", content: `Generá tags optimizados para HL.\n${rules}\n\n${userBlock}` }
      ],
      temperature: 0.2,
      max_tokens: 350
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: "openai_error", detail: data });
    }

    const raw = (data?.choices?.[0]?.message?.content || "").trim();

    // ---------- Post-procesado ----------
    // 1) normalizamos output del modelo a array de tags
    const initial = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, " "));

    // 2) dedupe + filtro por longitud
    const { out: cleaned, seen } = uniqTags(initial);

    // 3) empujar 1–3 apodos por equipo (si entran)
    function pushIfNew(arr, seenSet, tag) {
      const t = String(tag || "").trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (seenSet.has(key)) return;
      if (t.length > 60) return;
      seenSet.add(key);
      arr.push(t);
    }

    const extras = [];
    homeNicks.slice(0, 3).forEach((n) => pushIfNew(extras, seen, n));
    awayNicks.slice(0, 3).forEach((n) => pushIfNew(extras, seen, n));

    const combined = [...cleaned, ...extras];

    // 4) recorte por maxLen total
    const finalText = joinWithinLimit(combined, Number(maxLen));

    return res.status(200).json({ tags: finalText || "Error generando tags." });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}
