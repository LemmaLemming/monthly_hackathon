import "dotenv/config";
import express from "express";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn("ELEVENLABS_API_KEY is not set. /scribe-token will fail until it is configured.");
}

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Placeholder auth. Replace this with real session or JWT validation before production use.
function placeholderAuthMiddleware(_req, _res, next) {
  next();
}

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/scribe-token", placeholderAuthMiddleware, async (_req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    res.status(500).json({
      error: "Missing ELEVENLABS_API_KEY on the server.",
    });
    return;
  }

  try {
    const token = await elevenlabs.tokens.singleUse.create("realtime_scribe");
    res.json(token);
  } catch (error) {
    console.error("Failed to create ElevenLabs single-use token:", error);
    res.status(500).json({
      error: "Failed to create a realtime_scribe token.",
    });
  }
});

app.listen(port, host, () => {
  console.log(`Live transcription app running at http://${host}:${port}`);
});
