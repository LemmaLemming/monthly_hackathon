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

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const workflowStatuses = new Set([
  "waiting_for_review",
  "under_review",
  "awaiting_clarification",
  "advice_sent",
  "case_closed",
]);

const escalatedCases = [
  {
    id: "ESC-1001",
    patientName: "Margaret Johnson",
    patientAge: 51,
    sex: "F",
    urgency: "Emergent",
    waitingMinutes: 14,
    status: "waiting_for_review",
    chiefConcern: "Severe chest pressure radiating to left arm",
    symptomTimeline: [
      "20 mins: central chest pain began while resting",
      "15 mins: cold sweat and mild nausea",
      "10 mins: pain radiated to left arm",
    ],
    redFlags: ["Diaphoresis", "Radiating chest pain", "History of AMI"],
    medications: ["Metoprolol"],
    history: "Acute myocardial infarction (2 years ago), hypertension.",
    operatorNotes:
      "Patient is alert and speaking full sentences. Reports pain 8/10. No known trauma. Partner confirms cardiac history.",
    clinicalRecap:
      "AI draft recap: likely high-risk cardiac presentation with active red-flag symptoms requiring immediate escalation.",
    transcriptEvidence: [
      {
        speaker: "Patient",
        timestamp: "14:03:22",
        text: "I have crushing chest pressure and it's going into my left arm.",
      },
      {
        speaker: "Operator",
        timestamp: "14:03:46",
        text: "Are you short of breath or sweating?",
      },
      {
        speaker: "Patient",
        timestamp: "14:03:53",
        text: "Yes, I am sweating and feel really nauseous.",
      },
    ],
    aiDraft: {
      protocols: [
        "Code 1 - Immediate ER",
        "Activate chest pain pathway",
        "No home-care disposition",
      ],
      disposition: "Immediate emergency department referral.",
      rationale:
        "Multiple high-risk ACS features, prior cardiac history, and persistent severe symptoms in transcript evidence.",
      carePathways: ["Immediate ER", "Urgent Care", "Home Monitoring"],
      followUpSummaryDraft:
        "Please proceed to emergency care now. Do not drive yourself. Bring medication list and seek immediate reassessment.",
    },
    messages: [
      {
        id: "m1",
        sender: "operator",
        kind: "question",
        text: "Can you confirm if this should bypass urgent care and route straight to ER?",
        createdAt: Date.now() - 5 * 60 * 1000,
      },
    ],
    reviewedAdvice: "",
    selectedCarePathway: "",
    finalFollowUpSummary: "",
    updatedAt: Date.now() - 4 * 60 * 1000,
  },
  {
    id: "ESC-1002",
    patientName: "Robert Chen",
    patientAge: 64,
    sex: "M",
    urgency: "Urgent",
    waitingMinutes: 9,
    status: "under_review",
    chiefConcern: "Low back pain after slip on ice",
    symptomTimeline: [
      "60 mins: slip on ice and landed on lower back",
      "45 mins: pain increased while walking",
      "Now: no numbness, no bowel/bladder changes",
    ],
    redFlags: ["Age over 60"],
    medications: ["Ibuprofen"],
    history: "Chronic low back pain, no anticoagulants.",
    operatorNotes:
      "Ambulatory with antalgic gait. No neurological deficits reported in rapid screen.",
    clinicalRecap:
      "AI draft recap: moderate-risk musculoskeletal injury, no current severe neurological red flags.",
    transcriptEvidence: [
      {
        speaker: "Patient",
        timestamp: "14:09:11",
        text: "I can walk but it hurts a lot in the lower back.",
      },
      {
        speaker: "Operator",
        timestamp: "14:09:30",
        text: "Any numbness in your legs or trouble controlling bladder or bowels?",
      },
      {
        speaker: "Patient",
        timestamp: "14:09:35",
        text: "No, none of that.",
      },
    ],
    aiDraft: {
      protocols: ["Code 3 - Urgent Care", "Lumbar strain pathway", "Red-flag safety netting"],
      disposition: "Urgent same-day in-person assessment.",
      rationale:
        "Mechanism of injury and age suggest in-person reassessment; no high-risk neuro symptoms currently reported.",
      carePathways: ["Urgent Care", "Home Monitoring", "Immediate ER"],
      followUpSummaryDraft:
        "Attend urgent care today for exam. Seek emergency care if weakness, numbness, or bladder/bowel symptoms occur.",
    },
    messages: [
      {
        id: "m2",
        sender: "specialist",
        kind: "clarification_request",
        text: "Please confirm any anticoagulant use and whether pain worsens with leg raise.",
        createdAt: Date.now() - 6 * 60 * 1000,
      },
      {
        id: "m3",
        sender: "operator",
        kind: "clarification_reply",
        text: "No anticoagulants. Leg raise causes local pain but no radicular symptoms.",
        createdAt: Date.now() - 4 * 60 * 1000,
      },
    ],
    reviewedAdvice: "",
    selectedCarePathway: "",
    finalFollowUpSummary: "",
    updatedAt: Date.now() - 3 * 60 * 1000,
  },
  {
    id: "ESC-1003",
    patientName: "Liam Smith",
    patientAge: 8,
    sex: "M",
    urgency: "Less Urgent",
    waitingMinutes: 6,
    status: "awaiting_clarification",
    chiefConcern: "Persistent cough with mild wheeze",
    symptomTimeline: [
      "3 days: cough started",
      "Tonight: mild wheeze while lying down",
      "Current: afebrile, speaking full sentences",
    ],
    redFlags: ["Pediatric respiratory symptoms"],
    medications: ["None reported"],
    history: "Recurrent upper respiratory infections.",
    operatorNotes: "Parent reports no cyanosis, no chest retractions, good oral intake.",
    clinicalRecap:
      "AI draft recap: low-to-moderate acuity respiratory case pending clarification on breathing effort and asthma history.",
    transcriptEvidence: [
      {
        speaker: "Parent",
        timestamp: "14:12:02",
        text: "He has had a cough for 3 days and started wheezing tonight.",
      },
      {
        speaker: "Operator",
        timestamp: "14:12:20",
        text: "Is he struggling to breathe right now?",
      },
      {
        speaker: "Parent",
        timestamp: "14:12:27",
        text: "No, he is talking okay but sounds wheezy.",
      },
    ],
    aiDraft: {
      protocols: ["Code 4 - Review + monitor", "Pediatric wheeze protocol", "Escalation triggers education"],
      disposition: "Home monitoring with strict escalation precautions unless breathing worsens.",
      rationale:
        "No severe distress signs in transcript; pediatric wheeze still needs close follow-up and safety instructions.",
      carePathways: ["Home Monitoring", "Urgent Care", "Immediate ER"],
      followUpSummaryDraft:
        "Monitor breathing overnight and hydration. Seek urgent care if wheeze worsens; call emergency services for severe distress.",
    },
    messages: [
      {
        id: "m4",
        sender: "specialist",
        kind: "clarification_request",
        text: "Please ask about prior asthma diagnosis and inhaler availability.",
        createdAt: Date.now() - 2 * 60 * 1000,
      },
    ],
    reviewedAdvice: "",
    selectedCarePathway: "",
    finalFollowUpSummary: "",
    updatedAt: Date.now() - 90 * 1000,
  },
];

const specialistSseClients = new Set();

function statusLabel(status) {
  return status.replaceAll("_", " ");
}

function normalizeCase(caseItem) {
  return {
    ...caseItem,
    statusLabel: statusLabel(caseItem.status),
  };
}

function sortCases() {
  return [...escalatedCases].sort((a, b) => b.updatedAt - a.updatedAt);
}

function findCaseOrNull(caseId) {
  return escalatedCases.find((entry) => entry.id === caseId) || null;
}

function broadcastSpecialist(event, payload) {
  const packet = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of specialistSseClients) {
    client.write(packet);
  }
}

function emitCaseUpdate(caseItem) {
  broadcastSpecialist("case_updated", normalizeCase(caseItem));
}

function addMessage(caseItem, sender, kind, text) {
  const message = {
    id: `m-${Math.random().toString(36).slice(2, 10)}`,
    sender,
    kind,
    text,
    createdAt: Date.now(),
  };

  caseItem.messages.push(message);
  caseItem.updatedAt = Date.now();
  emitCaseUpdate(caseItem);

  return message;
}

app.get("/specialist", (_req, res) => {
  res.redirect("/specialist/");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/specialist/cases", (_req, res) => {
  const cases = sortCases().map(normalizeCase);
  res.json({
    cases,
    statuses: [...workflowStatuses],
  });
});

app.get("/api/specialist/cases/:caseId", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  res.json({ case: normalizeCase(caseItem) });
});

app.patch("/api/specialist/cases/:caseId/status", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  const status = String(req.body.status || "").trim();

  if (!workflowStatuses.has(status)) {
    res.status(400).json({ error: "Invalid workflow status." });
    return;
  }

  caseItem.status = status;
  caseItem.updatedAt = Date.now();
  emitCaseUpdate(caseItem);

  res.json({ case: normalizeCase(caseItem) });
});

app.post("/api/specialist/cases/:caseId/messages", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  const text = String(req.body.text || "").trim();
  const sender = String(req.body.sender || "specialist").trim();
  const kind = String(req.body.kind || "note").trim();

  if (!text) {
    res.status(400).json({ error: "Message text is required." });
    return;
  }

  const message = addMessage(caseItem, sender, kind, text);
  res.json({ message, case: normalizeCase(caseItem) });
});

app.post("/api/specialist/cases/:caseId/request-clarification", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  const text = String(req.body.text || "").trim();

  if (!text) {
    res.status(400).json({ error: "Clarification request text is required." });
    return;
  }

  caseItem.status = "awaiting_clarification";
  addMessage(caseItem, "specialist", "clarification_request", text);

  res.json({ case: normalizeCase(caseItem) });
});

app.post("/api/specialist/cases/:caseId/advice", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  const text = String(req.body.text || "").trim();
  const carePathway = String(req.body.carePathway || "").trim();

  if (!text) {
    res.status(400).json({ error: "Reviewed advice text is required." });
    return;
  }

  caseItem.reviewedAdvice = text;
  caseItem.selectedCarePathway = carePathway;
  caseItem.status = "advice_sent";
  caseItem.updatedAt = Date.now();

  addMessage(caseItem, "specialist", "reviewed_advice", text);

  res.json({ case: normalizeCase(caseItem) });
});

app.post("/api/specialist/cases/:caseId/final-summary", (req, res) => {
  const caseItem = findCaseOrNull(req.params.caseId);

  if (!caseItem) {
    res.status(404).json({ error: "Case not found." });
    return;
  }

  const text = String(req.body.text || "").trim();
  const closeCase = Boolean(req.body.closeCase);

  if (!text) {
    res.status(400).json({ error: "Final follow-up summary is required." });
    return;
  }

  caseItem.finalFollowUpSummary = text;
  caseItem.updatedAt = Date.now();

  if (closeCase) {
    caseItem.status = "case_closed";
  }

  emitCaseUpdate(caseItem);
  res.json({ case: normalizeCase(caseItem) });
});

app.get("/api/specialist/stream", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  specialistSseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  res.on("close", () => {
    clearInterval(heartbeat);
    specialistSseClients.delete(res);
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
  console.log(`Specialist dashboard available at http://${host}:${port}/specialist/`);
});
