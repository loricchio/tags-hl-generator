// api/generate.js
export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // si querés, cambiá por "https://loricchio.github.io"
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    // ---------- Utils ----------
    const norm = (s) =>
      String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    let NICK_DB = null;
    async function loadNicknames() {
      if (NICK_DB) return NICK_DB;
      // 1) Import JSON empacado en el build de Vercel
      try {
        const mod = await import("../data/nicknames.json", { assert: { type: "json" } });
        NICK_DB = mod.default || mod;
        return NICK_DB;
      } catch {
        // 2) Fallback a raw GitHub (por si falla el import en algún entorno)
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
        if (tag.length > 60) continue; // tag máximo 60 chars
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

    function toArrayOfLines(raw) {
      if (Array.isArray(raw)) return raw;
      return String(raw || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
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

    const scorersArr = toArrayOfLines(scorers);
    const scorersText = scorersArr.join(", ");

    // ---------- Nicknames ----------
    const db = await loadNicknames();
    const homeNicks = lookupNicknames(db, homeTeam);
    const awayNicks = lookupNicknames(db, awayTeam);

    // ---------- Prompt ----------
    const rules = `
- Idioma base: Español, pero incluir SIEMPRE etiquetas útiles en inglés: "highlights" y 2–3 entre "goals", "recap", "best moments", "extended highlights".
- NO inventar años/fechas/temporadas. SOLO incluir si viene explícito en 'matchDate'.
- Sinónimos de competencia solo si corresponden con "${competition}" (no mezclar Primera si es Segunda).
- Cruces: SIEMPRE en formato de pareja: "EquipoA EquipoB …" y "EquipoB EquipoA …".
  ⛔ No generes tags funcionales por equipo solo (p. ej. "Mirandes goals"). Si vas a usar "highlights/goals/recap/best moments", debe ser con ambos equipos.
- Goleadores: por cada uno, incluir 2 variantes (nombre completo y apellido) y un tag de acción: "gol de <apellido>".
- Evitar relleno/marketing: nada de "emoción en el campo", "espectáculo futbolístico", "partido completo".
- Sin duplicados (case-insensitive). Sin '#'. Cada tag ≤ 60 caracteres.
- Si 'contextNotes' trae algo puntual (ej. "doblete de X", "derbi", "UCL group stage"), incluir 1–3 tags de eso, sin inventar.
- Objetivo: 20–28 tags útiles. Devolver SOLO la lista separada por comas.
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

    // ---------- Post-procesado (modelo → array limpio) ----------
    const initial = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, " "));

    const { out: cleaned, seen } = uniqTags(initial);
    // --- Bloquea tags "funcionales" por equipo solo (ej: "mirandes goals") y fuerza minúsculas al final
const A_ES = ["resumen", "goles", "mejores jugadas", "resultado", "compacto"];
const A_EN = ["highlights", "goals", "recap", "best moments", "extended highlights"];

const h = norm(homeTeam);      // normalizados (sin acentos, minúsculas)
const a = norm(awayTeam);

function includesWord(s, w) {
  return new RegExp(`(^|\\s)${w}(\\s|$)`, "i").test(s);
}
function isTeamOnlyActionTag(tag) {
  const t = tag.toLowerCase();
  const hasHome = includesWord(norm(t), h);
  const hasAway = includesWord(norm(t), a);
  const hasAction = [...A_ES, ...A_EN].some(k => t.includes(k));
  return hasAction && ((hasHome && !hasAway) || (!hasHome && hasAway));
}

// 2.a) limpiamos los funcionales "por equipo"
const cleanedNoSolo = cleaned.filter(t => !isTeamOnlyActionTag(t));

    // ---------- Apodos (1–3 por lado) ----------
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

    // ---------- Tags OBLIGATORIOS (ambos órdenes) ----------
    const scoreTag = `${homeScore}-${awayScore}`;
    const pairs = [
      `${homeTeam} ${awayTeam}`,
      `${awayTeam} ${homeTeam}`
    ];
    const mandatory = [];
    for (const p of pairs) {
      pushIfNew(mandatory, seen, `${p} resumen`);
      pushIfNew(mandatory, seen, `${p} goles`);
      pushIfNew(mandatory, seen, `${p} highlights`);
      pushIfNew(mandatory, seen, `${p} resultado`);
      pushIfNew(mandatory, seen, `${p} ${scoreTag}`);
    }

   / combinado final (modelo + apodos + obligatorios)
const combined = [...cleanedNoSolo, ...extras, ...mandatory];

// 🔻 Fuerza minúsculas en TODOS los tags
const combinedLower = combined.map(t => String(t).toLowerCase());

// Recorte final
const finalText = joinWithinLimit(combinedLower, Number(maxLen));

    return res.status(200).json({ tags: finalText || "Error generando tags." });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}
