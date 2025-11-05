export default async function handler(req, res) {
  // 🔓 Habilitar CORS (permite que GitHub Pages acceda)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // respuesta rápida a preflight
  }

  try {
    const body = await req.json?.() || {};
    const {
      competition = '',
      homeTeam = '',
      awayTeam = '',
      homeScore = 0,
      awayScore = 0,
      scorers = '',
      lang = 'es',
      maxLen = 500
    } = body;

    const text = `
Generá una lista optimizada de tags para un video de highlights de YouTube.
Datos:
Competencia: ${competition}
Local: ${homeTeam}
Visitante: ${awayTeam}
Resultado: ${homeScore}-${awayScore}
Goleadores: ${scorers}

Reglas:
- Idioma: ${lang === 'es' ? 'Español' : 'Inglés'}
- Incluí competencia, equipos, marcador, goleadores (con apodos conocidos), y contexto (highlights, resumen, goles, etc.)
- Sin duplicados, sin hashtags (#), máximo ${maxLen} caracteres totales, tags separados por coma.
Devolvé sólo el texto de tags.
`.trim();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Sos un generador de tags deportivos para YouTube.' },
          { role: 'user', content: text }
        ],
        max_tokens: 300
      })
    });

    const data = await response.json();
    const tags = data?.choices?.[0]?.message?.content?.trim() || 'Error generando tags.';
    return res.status(200).json({ tags });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del proxy', detail: String(err) });
  }
}
