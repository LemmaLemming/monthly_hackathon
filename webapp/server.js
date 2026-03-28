import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn("ELEVENLABS_API_KEY is not set. /scribe-token will fail until it is configured.");
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. /api/ai/summary will fail until it is configured.");
}

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const consultationClients = {
  dispatcher: new Set(),
  physician: new Set(),
};

const consultationMessages = [
  {
    id: "seed-physician-summary",
    author: "physician",
    role: "Dr. Aris Thorne",
    kind: "message",
    timestamp: "14:22:40",
    text:
      "54-year-old, chest pressure and heaviness for 20+ minutes, persistent despite antacids. Pain radiating left. Escalating symptoms. Treat as cardiac until proven otherwise.",
  },
  {
    id: "seed-dispatcher-ack",
    author: "dispatcher",
    role: "Dispatcher",
    kind: "message",
    timestamp: "14:22:40",
    text: "Okay",
  },
];

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function broadcastConsultationMessage(message) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;

  for (const clientGroup of Object.values(consultationClients)) {
    for (const response of clientGroup) {
      response.write(payload);
    }
  }
}

function registerConsultationClient(type, response) {
  const group = consultationClients[type] || consultationClients.dispatcher;
  group.add(response);

  response.write("retry: 3000\n\n");

  return () => {
    group.delete(response);
  };
}

// Placeholder auth. Replace this with real session or JWT validation before production use.
function placeholderAuthMiddleware(_req, _res, next) {
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/physicians-portal", express.static(path.join(__dirname, "..", "physicians-portal", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/consultation/history", (_req, res) => {
  res.json({
    physician: {
      name: "Dr. Aris Thorne",
      status: "AVAILABLE",
    },
    messages: consultationMessages,
  });
});

app.post("/api/ai/summary", async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt) {
    res.status(400).json({ error: "prompt is required." });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "Missing GEMINI_API_KEY on the server." });
    return;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
      },
    );

    const payload = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: payload.error?.message || "Failed to generate Gemini summary.",
      });
      return;
    }

    const summary =
      payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() || "";

    res.json({ summary });
  } catch (error) {
    console.error("Failed to generate Gemini summary:", error);
    res.status(500).json({ error: "Failed to generate Gemini summary." });
  }
});

app.get("/api/consultation/stream", (req, res) => {
  const type = req.query.client === "physician" ? "physician" : "dispatcher";

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const unregister = registerConsultationClient(type, res);

  req.on("close", () => {
    unregister();
    res.end();
  });
});

app.post("/api/consultation/messages", (req, res) => {
  const { author, role, kind = "message", text } = req.body || {};

  if (!text || !author || !role) {
    res.status(400).json({ error: "author, role, and text are required." });
    return;
  }

  const message = {
    id: `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    author,
    role,
    kind,
    text,
    timestamp: formatTimestamp(),
  };

  consultationMessages.push(message);
  broadcastConsultationMessage(message);
  res.status(201).json({ ok: true, message });
});

app.post("/api/patient/sms", (req, res) => {
  const { message } = req.body || {};

  if (!message) {
    res.status(400).json({ error: "message is required." });
    return;
  }

  console.log("Placeholder SMS queued for patient follow-up:");
  console.log(message);

  res.status(200).json({
    ok: true,
    status: "SMS queued to patient follow-up channel.",
  });
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
