import OpenAI from "openai";
import cors from "cors";
import express from "express";

const app = express();
app.use(express.json());
app.use(cors());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/generate", async (req, res) => {
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

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content;
    res.json({ tags: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ tags: "Error generando tags." });
  }
});

app.listen(3000, () => console.log("Servidor de tags activo"));
