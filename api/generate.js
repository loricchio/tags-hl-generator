export default async function handler(req, res) {
// --- CORS ---
res.setHeader("Access-Control-Allow-Origin", "https://loricchio.github.io"); // o "*" si querés
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST")  return res.status(405).json({ error: "Método no permitido" });

  try {
    // Body seguro (Node serverless)
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
      maxLen = 500
    } = body;

    const scorersText = Array.isArray(scorers) ? scorers.join(", ") : String(scorers || "");

    const prompt = `
Generá una lista optimizada de tags para un video de highlights de YouTube.
Datos:
- Competencia: ${competition}
- Local: ${homeTeam}
- Visitante: ${awayTeam}
- Resultado: ${homeScore}-${awayScore}
- Goleadores: ${scorersText}

Reglas:
- Idioma: ${lang === "es" ? "Español" : "Inglés"}
- Incluir competencia, equipos, cruces ("X vs Y" y "Y vs X"), marcador, contexto (highlights/resumen/goles/...), goleadores y apodos conocidos (p.ej. Cristian Romero → Cuti Romero).
- Sin duplicados ni hashtags (#).
- Devolvé SOLO los tags separados por comas, con un total máximo de ${maxLen} caracteres.
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
          { role: "system", content: "Sos un generador de tags deportivos para YouTube: conciso, sin duplicados." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    const data = await r.json();

    if (!r.ok) {
      // 👉 Ahora devolvemos el status original y el detalle claro
      return res.status(r.status).json({
        error: "openai_error",
        status: r.status,
        detail: data
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || "Error generando tags.";
    return res.status(200).json({ tags: text });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: String(err) });
  }
}
