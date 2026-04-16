import "dotenv/config";
import crypto from "node:crypto";
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
const AUTH_USERNAME = process.env.AUTH_USERNAME || "";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const AUTH_SCRYPT_SALT = process.env.AUTH_SCRYPT_SALT || "healthline-auth";
const SESSION_COOKIE_NAME = "healthline_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const isAuthConfigured = Boolean(AUTH_USERNAME && AUTH_PASSWORD);
const AUTH_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  (isAuthConfigured
    ? crypto
        .createHash("sha256")
        .update(`${AUTH_USERNAME}:${AUTH_PASSWORD}:${AUTH_SCRYPT_SALT}`)
        .digest("hex")
    : crypto.randomBytes(32).toString("hex"));
const expectedPasswordHash = isAuthConfigured
  ? crypto.scryptSync(AUTH_PASSWORD, AUTH_SCRYPT_SALT, 64)
  : null;
const publicDir = path.join(__dirname, "public");
const physiciansPortalDir = path.join(__dirname, "..", "physicians-portal", "public");

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn("ELEVENLABS_API_KEY is not set. /scribe-token will fail until it is configured.");
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. /api/ai/summary will fail until it is configured.");
}

if (!isAuthConfigured) {
  console.warn("AUTH_USERNAME and AUTH_PASSWORD are not set. Login will remain unavailable until they are configured.");
} else if (!process.env.AUTH_SESSION_SECRET) {
  console.warn("AUTH_SESSION_SECRET is not set. Using a derived fallback secret for signed sessions.");
}

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const consultationClients = {
  dispatcher: new Set(),
  physician: new Set(),
};

const consultationMessages = [];

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

function parseCookies(headerValue) {
  const cookies = {};

  if (!headerValue) {
    return cookies;
  }

  for (const pair of headerValue.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function signSessionValue(value) {
  return crypto.createHmac("sha256", AUTH_SESSION_SECRET).update(value).digest("base64url");
}

function serializeSessionCookie(session) {
  const sessionValue = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signedValue = `${sessionValue}.${signSessionValue(sessionValue)}`;
  const maxAgeSeconds = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function clearSessionCookie() {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function readSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const signedValue = cookies[SESSION_COOKIE_NAME];

  if (!signedValue) {
    return null;
  }

  const separatorIndex = signedValue.lastIndexOf(".");

  if (separatorIndex === -1) {
    return null;
  }

  const sessionValue = signedValue.slice(0, separatorIndex);
  const providedSignature = signedValue.slice(separatorIndex + 1);
  const expectedSignature = signSessionValue(sessionValue);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(sessionValue, "base64url").toString("utf8"));

    if (!session || typeof session.username !== "string" || typeof session.expiresAt !== "number") {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function createSession(username) {
  return {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function credentialsAreValid(username, password) {
  if (!expectedPasswordHash) {
    return false;
  }

  if (!safeEqualString(username, AUTH_USERNAME)) {
    return false;
  }

  const attemptedPasswordHash = crypto.scryptSync(password || "", AUTH_SCRYPT_SALT, 64);
  return crypto.timingSafeEqual(attemptedPasswordHash, expectedPasswordHash);
}

function authUnavailable(res) {
  res.status(503).json({
    error: "Login is unavailable because AUTH_USERNAME and AUTH_PASSWORD are not configured on the server.",
  });
}

function requireAuth(req, res, next) {
  if (!isAuthConfigured) {
    authUnavailable(res);
    return;
  }

  if (!req.authSession) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  next();
}

function isHtmlNavigationRequest(req) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const accept = req.headers.accept || "";
  return accept.includes("text/html");
}

function redirectToLogin(res, nextPath) {
  const target = nextPath && nextPath !== "/" ? `/?next=${encodeURIComponent(nextPath)}` : "/";
  res.redirect(target);
}

function requirePhysicianPortalAuth(req, res, next) {
  if (!isAuthConfigured) {
    if (isHtmlNavigationRequest(req)) {
      redirectToLogin(res, req.originalUrl);
      return;
    }

    authUnavailable(res);
    return;
  }

  if (req.authSession) {
    next();
    return;
  }

  res.setHeader("Set-Cookie", clearSessionCookie());

  if (isHtmlNavigationRequest(req)) {
    redirectToLogin(res, req.originalUrl);
    return;
  }

  res.status(401).json({ error: "Authentication required." });
}

app.use(express.json());
app.use((req, _res, next) => {
  req.authSession = readSessionFromRequest(req);
  next();
});

app.get("/api/auth/session", (req, res) => {
  if (!isAuthConfigured) {
    authUnavailable(res);
    return;
  }

  if (!req.authSession) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(401).json({ error: "No active session." });
    return;
  }

  res.json({
    ok: true,
    username: req.authSession.username,
    expiresAt: req.authSession.expiresAt,
  });
});

app.post("/api/auth/login", (req, res) => {
  if (!isAuthConfigured) {
    authUnavailable(res);
    return;
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  if (!credentialsAreValid(username, password)) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const session = createSession(AUTH_USERNAME);
  res.setHeader("Set-Cookie", serializeSessionCookie(session));
  res.json({
    ok: true,
    username: session.username,
    expiresAt: session.expiresAt,
  });
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.use(express.static(publicDir));
app.use("/physicians-portal", requirePhysicianPortalAuth, express.static(physiciansPortalDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/consultation/history", requireAuth, (_req, res) => {
  res.json({
    physician: {
      name: "Dr. Aris Thorne",
      status: "AVAILABLE",
    },
    messages: consultationMessages,
  });
});

app.post("/api/ai/summary", requireAuth, async (req, res) => {
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

app.get("/api/consultation/stream", requireAuth, (req, res) => {
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

app.post("/api/consultation/messages", requireAuth, (req, res) => {
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

app.post("/api/patient/sms", requireAuth, (req, res) => {
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

app.get("/scribe-token", requireAuth, async (_req, res) => {
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
