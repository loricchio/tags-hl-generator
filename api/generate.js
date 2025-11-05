import OpenAI from "openai";

export default async function handler(req, res) {
  // Habilitar CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { competition, homeTeam, awayTeam, homeScore, awayScore, scorers } = req.body;

    const prompt = `
Generá tags para un video de YouTube de highlights deportivos.
Competencia: ${competition}
Equipos: ${homeTeam} vs ${awayTeam}
Resultado: ${homeScore}-${awayScore}
Goleadores: ${scorers?.join(", ")}

Usá nombres de jugadores, apodos conocidos, nombres de equipos y términos populares en español.
Separá los tags con comas.
    `;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content;
    res.status(200).json({ tags: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ tags: "Error generando tags." });
  }
}
