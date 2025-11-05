import OpenAI from "openai";

export default async function handler(req, res) {
  // --- Configuración CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
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

    const tags = completion.choices[0].message.content;
    res.status(200).json({ tags });
  } catch (error) {
    console.error("Error generando tags:", error);
    res.status(500).json({ tags: "Error generando tags." });
  }
}
