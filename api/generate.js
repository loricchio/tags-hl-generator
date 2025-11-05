export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "https://loricchio.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")  return res.status(405).json({ error: "Método no permitido" });

  try {
    // Body seguro
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
      lang = "es",          // es | en (usamos 'es' como base; igual mezclamos)
      maxLen = 500,
      matchDate = "",       // opcional: "2025-11-05" o texto libre
      contextNotes = ""     // opcional: texto con 1–3 datos de contexto
    } = body;

    const scorersText = Array.isArray(scorers) ? scorers.join(", ") : String(scorers || "");

    const rules = `
- Idioma base: Español, pero incluir SIEMPRE algunas etiquetas en inglés: al menos "highlights" y 2 variantes entre: "goals", "extended highlights", "best moments", "recap".
- NO inventar años, temporadas, ni fechas. SOLO incluir año/fecha si viene explícitamente en 'matchDate'. Si no viene, OMITIR cualquier año.
- Evitar frases vacías/marketineras: nada de "emoción en el campo", "espectáculo futbolístico", "partido completo".
- Incluir: competencia, equipos, cruces ("X vs Y" y "Y vs X"), marcador, términos de HL, goleadores con apodos conocidos (p.ej. Cristian Romero → Cuti Romero).
- Sin duplicados (case-insensitive). Sin '#'. Cada tag ≤ 60 caracteres.
- Si hay 'contextNotes', sumar 1–3 tags específicos derivados de eso (p.ej. "debut de X", "UCL group stage", "derby madrileño"), sin inventar datos.
- Devolver SOLO una lista de tags separadas por comas (texto plano), sin texto adicional.
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
`.trim();

    // Llamada directa a OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Sos un generador de tags deportivos para YouTube: preciso, conciso y sin relleno." },
          { role: "user", content: `Generá tags optimizados para HL.\n${rules}\n\n${userBlock}` }
        ],
        temperature: 0.2,
        max_tokens: 350
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: "openai_error", detail: data });
    }

    // Parse simple: texto plano "tag1, tag2, ..."
    const raw = (data?.choices?.[0]?.message?.content || "").trim();
    // Post-procesado: dedupe y recorte a maxLen
    const seen = new Set();
    const cleaned = raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\s+/g, " "))            // normaliza espacios
      .filter(t => {
        const key = t.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter(t => t.length <= 60);

    // recortar al límite total
    const out = [];
    for (const t of cleaned) {
      const probe = out.length ? out.join(", ") + ", " + t : t;
      if (probe.length <= Number(maxLen)) out.push(t); else break;
    }

    return res.status(200).json({ tags: out.join(", ") || "Error generando tags." });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}

