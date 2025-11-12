// api/generate.js — v2 (EN fijo + Disney/ESPN + fuzzy teams, sin “superestrellas”)

const ORIGIN = "https://loricchio.github.io"; // ajustá si usás otro front

// --- CORS simple ---
function setCORS(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCORS(res, req.headers.origin);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    // --- Utils ---
    const normalize = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}+/gu, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    const titleCaseName = (s) => {
      const minors = new Set(["de", "del", "da", "do", "dos", "las", "los", "y", "e", "la", "el"]);
      return String(s || "")
        .split(/\s+/)
        .map((w, i) => (minors.has(w.toLowerCase()) && i > 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ");
    };

    // Levenshtein básico
    function dist(a, b) {
      const m = a.length, n = b.length;
      if (!m) return n;
      if (!n) return m;
      const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      return dp[m][n];
    }

    // --- Body seguro ---
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }

    let {
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

    // --- Nicknames / Teams DB ---
    let NICK_DB = null;
    async function loadNicknames() {
      if (NICK_DB) return NICK_DB;
      try {
        const mod = await import("../data/nicknames.json", { assert: { type: "json" } });
        NICK_DB = mod.default || mod;
      } catch {
        const rawUrl = "https://raw.githubusercontent.com/loricchio/tags-hl-generator/main/data/nicknames.json";
        const resp = await fetch(rawUrl);
        NICK_DB = resp.ok ? await resp.json() : { teams: {} };
      }
      // Estructura esperada:
      // { "teams": { "<nombre-normalizado>": { canonical: "Real Betis", aliases: ["betis","real betiz"], short: "Betis" }, ... } }
      return NICK_DB;
    }

    function canonicalTeam(input, teamsMap) {
      const n = normalize(input);
      if (!n) return { canonical: titleCaseName(input), short: titleCaseName(input) };

      // 1) match directo por key
      if (teamsMap[n]) {
        const t = teamsMap[n];
        return {
          canonical: t.canonical || titleCaseName(n),
          short: t.short || (t.canonical || "").replace(/^Real\s+/i, "").trim() || titleCaseName(n)
        };
      }
      // 2) por aliases
      for (const key of Object.keys(teamsMap)) {
        const t = teamsMap[key];
        const aliases = [key, ...(t.aliases || [])].map(normalize);
        if (aliases.includes(n)) {
          return {
            canonical: t.canonical || titleCaseName(key),
            short: t.short || (t.canonical || "").replace(/^Real\s+/i, "").trim()
          };
        }
      }
      // 3) fuzzy (umbral 2)
      let best = { score: Infinity, hit: null };
      for (const key of Object.keys(teamsMap)) {
        const t = teamsMap[key];
        const cand = [key, ...(t.aliases || [])];
        for (const c of cand) {
          const d = dist(n, normalize(c));
          if (d < best.score) best = { score: d, hit: key };
        }
      }
      if (best.hit && best.score <= 2) {
        const t = teamsMap[best.hit];
        return {
          canonical: t.canonical || titleCaseName(best.hit),
          short: t.short || (t.canonical || "").replace(/^Real\s+/i, "").trim()
        };
      }
      // 4) fallback
      return { canonical: titleCaseName(input), short: titleCaseName(input) };
    }

    function uniqTags(list) {
      const seen = new Set();
      const out = [];
      for (const t of list) {
        const tag = String(t || "").trim();
        if (!tag) continue;
        const key = normalize(tag).replace(/[^a-z0-9 ]/g, "");
        if (seen.has(key)) continue;
        if (tag.length > 60) continue;
        seen.add(key);
        out.push(tag);
      }
      return { out, seen };
    }

    function joinWithinLimit(tags, maxLen, mandatoryCount) {
      const sep = ", ";
      let acc = "";
      const out = [];
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        const add = out.length ? sep + t : t;
        if (acc.length + add.length > maxLen) {
          if (out.length < mandatoryCount) {
            out.push(t);
            acc += add;
            continue;
          }
          break;
        }
        out.push(t);
        acc += add;
      }
      return out.join(sep);
    }

    const db = await loadNicknames();
    const teamsMap = db.teams || {};

    // --- Corrección de equipos (canónico + alias corto) ---
    const teamA = canonicalTeam(homeTeam, teamsMap);
    const teamB = canonicalTeam(awayTeam, teamsMap);
    const A = teamA.canonical;
    const B = teamB.canonical;
    const aShort = teamA.short || A;
    const bShort = teamB.short || B;

    // --- Construcción de tags por tiers (sin “superestrellas”) ---
    // EN fijos (exactamente 3)
    const enMandatory = [
      `${A} ${B} highlights`.toLowerCase(),
      `${B} ${A} highlights`.toLowerCase(),
      `highlights`
    ];

    // ES obligatorios
    const esMandatory = ["Disney Plus", "ESPN"];

    // Contexto ES
    const context = [];
    if (competition) context.push(titleCaseName(competition));
    context.push(`${A} vs ${B}`, `${A} vs ${B} resumen`, "goles");

    // Goleadores
    const scorersArr = Array.isArray(scorers) ? scorers : String(scorers || "").split(/\r?\n/);
    const goalTags = scorersArr
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .map((s) => `gol de ${titleCaseName(s)}`);

    // Aliases cortos
    const aliases = [];
    if (aShort && aShort !== A) aliases.push(aShort);
    if (bShort && bShort !== B) aliases.push(bShort);

    // Ensamble y dedup
    const tiers = [enMandatory, esMandatory, context, goalTags, aliases];
    const assembled = [];
    const seen = new Set();
    const keyOf = (t) => normalize(t).replace(/[^a-z0-9 ]/g, "");
    for (const tier of tiers) {
      for (const t of tier) {
        const key = keyOf(t);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // casing final
        if (t === "highlights" || / highlights$/.test(t)) {
          assembled.push(t); // las EN ya están en minúsculas
        } else if (t === "goles" || t === "resumen") {
          assembled.push(t);
        } else if (/^gol de /.test(t)) {
          assembled.push("gol de " + titleCaseName(t.slice(7)));
        } else if (/ vs /.test(t)) {
          const [L, R] = t.split(" vs ");
          assembled.push(`${titleCaseName(L)} vs ${titleCaseName(R)}`);
        } else if (t === "Disney Plus" || t === "ESPN") {
          assembled.push(t);
        } else {
          assembled.push(titleCaseName(t));
        }
      }
    }

    // Corte por caracteres preservando obligatorios (3 EN + 2 ES)
    const mandatoryCount = enMandatory.length + esMandatory.length; // 5
    const tags_line = joinWithinLimit(assembled, Number(maxLen || 500), mandatoryCount);

    return res.status(200).json({
      tags: assembled,
      tags_line,
      canonical: { homeTeam: A, awayTeam: B }
    });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}
