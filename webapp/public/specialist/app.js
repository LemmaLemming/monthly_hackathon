const queueListEl = document.getElementById("queueList");
const queueCountEl = document.getElementById("queueCount");
const caseDetailEl = document.getElementById("caseDetail");
const emptyStateEl = document.getElementById("emptyState");
const streamDotEl = document.getElementById("streamDot");
const streamStateEl = document.getElementById("streamState");

const state = {
  cases: [],
  selectedCaseId: null,
};

function safe(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  return String(status || "").replaceAll("_", " ");
}

function statusClass(status) {
  if (status === "waiting_for_review") {
    return "status-waiting";
  }

  if (status === "under_review") {
    return "status-review";
  }

  if (status === "awaiting_clarification") {
    return "status-clarify";
  }

  if (status === "advice_sent") {
    return "status-sent";
  }

  return "status-closed";
}

function urgencyClass(urgency) {
  const normalized = String(urgency || "").toLowerCase();

  if (normalized.includes("emergent")) {
    return "urgency-emergent";
  }

  if (normalized.includes("urgent")) {
    return "urgency-urgent";
  }

  return "urgency-low";
}

function formatMinutes(minutes) {
  return `${minutes} min waiting`;
}

function selectedCase() {
  return state.cases.find((entry) => entry.id === state.selectedCaseId) || null;
}

function upsertCase(updatedCase) {
  const index = state.cases.findIndex((entry) => entry.id === updatedCase.id);

  if (index === -1) {
    state.cases.push(updatedCase);
  } else {
    state.cases[index] = updatedCase;
  }

  state.cases.sort((a, b) => b.updatedAt - a.updatedAt);

  if (!state.selectedCaseId) {
    state.selectedCaseId = state.cases[0]?.id || null;
  }
}

function renderQueue() {
  queueCountEl.textContent = `${state.cases.length}`;

  if (state.cases.length === 0) {
    queueListEl.innerHTML = '<p class="muted">No escalated cases.</p>';
    return;
  }

  queueListEl.innerHTML = state.cases
    .map((entry) => {
      const selected = entry.id === state.selectedCaseId ? "selected" : "";

      return `
        <button class="queue-card ${selected}" data-case-id="${entry.id}">
          <div class="queue-topline">
            <span class="urgency-pill ${urgencyClass(entry.urgency)}">${safe(entry.urgency)}</span>
            <span class="wait-time">${formatMinutes(entry.waitingMinutes)}</span>
          </div>
          <strong>${safe(entry.patientName)}</strong>
          <p>${safe(entry.chiefConcern)}</p>
          <div class="queue-foot">
            <span>${safe(entry.id)}</span>
            <span class="status-pill ${statusClass(entry.status)}">${safe(statusLabel(entry.status))}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function listToTags(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<span class="chip">None reported</span>';
  }

  return items.map((item) => `<span class="chip">${safe(item)}</span>`).join("");
}

function listToBullets(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<li>Not available</li>";
  }

  return items.map((item) => `<li>${safe(item)}</li>`).join("");
}

function renderTranscriptEvidence(caseItem) {
  if (!Array.isArray(caseItem.transcriptEvidence) || caseItem.transcriptEvidence.length === 0) {
    return '<p class="muted">No transcript evidence available.</p>';
  }

  return caseItem.transcriptEvidence
    .map(
      (snippet) => `
      <article class="evidence-row">
        <div class="evidence-meta">
          <strong>${safe(snippet.speaker)}</strong>
          <span>${safe(snippet.timestamp)}</span>
        </div>
        <p>${safe(snippet.text)}</p>
      </article>
    `,
    )
    .join("");
}

function renderMessages(caseItem) {
  if (!Array.isArray(caseItem.messages) || caseItem.messages.length === 0) {
    return '<p class="muted">No messages yet.</p>';
  }

  const byTime = [...caseItem.messages].sort((a, b) => a.createdAt - b.createdAt);

  return byTime
    .map((message) => {
      const roleClass = message.sender === "specialist" ? "msg-specialist" : "msg-operator";
      const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      return `
        <article class="message-row ${roleClass}">
          <div class="message-meta">
            <strong>${safe(message.sender)}</strong>
            <span>${safe(message.kind)}</span>
            <span>${safe(timestamp)}</span>
          </div>
          <p>${safe(message.text)}</p>
        </article>
      `;
    })
    .join("");
}

function renderDetail() {
  const caseItem = selectedCase();

  if (!caseItem) {
    caseDetailEl.hidden = true;
    emptyStateEl.hidden = false;
    return;
  }

  caseDetailEl.hidden = false;
  emptyStateEl.hidden = true;

  const summaryDraft = caseItem.finalFollowUpSummary || caseItem.aiDraft.followUpSummaryDraft || "";

  caseDetailEl.innerHTML = `
    <section class="detail-header card">
      <div>
        <p class="case-id">${safe(caseItem.id)}</p>
        <h2>${safe(caseItem.patientName)} <span>${caseItem.patientAge}${safe(caseItem.sex)}</span></h2>
      </div>
      <div class="header-right">
        <span class="urgency-pill ${urgencyClass(caseItem.urgency)}">${safe(caseItem.urgency)}</span>
        <span class="status-pill ${statusClass(caseItem.status)}">${safe(statusLabel(caseItem.status))}</span>
      </div>
    </section>

    <section class="info-grid">
      <article class="card">
        <h3>Chief Concern</h3>
        <p>${safe(caseItem.chiefConcern)}</p>
      </article>
      <article class="card">
        <h3>Symptom Timeline</h3>
        <ul>${listToBullets(caseItem.symptomTimeline)}</ul>
      </article>
      <article class="card">
        <h3>Red Flags</h3>
        <div class="chips">${listToTags(caseItem.redFlags)}</div>
      </article>
      <article class="card">
        <h3>Medications</h3>
        <div class="chips">${listToTags(caseItem.medications)}</div>
      </article>
      <article class="card">
        <h3>History</h3>
        <p>${safe(caseItem.history)}</p>
      </article>
      <article class="card">
        <h3>Operator Notes</h3>
        <p>${safe(caseItem.operatorNotes)}</p>
      </article>
    </section>

    <section class="card">
      <div class="section-head">
        <h3>AI Structured Clinical Recap</h3>
        <span class="draft-pill">AI Draft</span>
      </div>
      <p>${safe(caseItem.clinicalRecap)}</p>
    </section>

    <section class="card">
      <h3>Source Transcript Evidence</h3>
      <div class="evidence-list">${renderTranscriptEvidence(caseItem)}</div>
    </section>

    <section class="card ai-card">
      <div class="section-head">
        <h3>AI Suggestions</h3>
        <span class="draft-pill">Review Required</span>
      </div>
      <div class="ai-grid">
        <article>
          <h4>Suggested Protocols</h4>
          <ul>${listToBullets(caseItem.aiDraft.protocols)}</ul>
        </article>
        <article>
          <h4>Suggested Disposition</h4>
          <p>${safe(caseItem.aiDraft.disposition)}</p>
        </article>
        <article>
          <h4>Rationale</h4>
          <p>${safe(caseItem.aiDraft.rationale)}</p>
        </article>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <h3>Communication Thread</h3>
        <span class="muted">Two-way operator/specialist exchange</span>
      </div>
      <div class="messages">${renderMessages(caseItem)}</div>
      <div class="composer-row">
        <textarea id="clarificationInput" rows="3" placeholder="Request more information from operator..."></textarea>
        <button data-action="request-clarification">Request Clarification</button>
      </div>
    </section>

    <section class="card">
      <h3>Response Composer</h3>
      <label class="label">Care Pathway</label>
      <select id="carePathwaySelect">
        ${(caseItem.aiDraft.carePathways || [])
          .map(
            (pathway) =>
              `<option value="${safe(pathway)}" ${
                caseItem.selectedCarePathway === pathway ? "selected" : ""
              }>${safe(pathway)}</option>`,
          )
          .join("")}
      </select>
      <label class="label">Reviewed Advice to Operator</label>
      <textarea id="adviceInput" rows="5" placeholder="Edit and send specialist guidance...">${safe(
        caseItem.reviewedAdvice,
      )}</textarea>
      <div class="composer-actions">
        <button data-action="set-under-review" class="ghost">Mark Under Review</button>
        <button data-action="send-advice" class="primary">Send Reviewed Advice</button>
      </div>
    </section>

    <section class="card">
      <h3>Final Patient Follow-up Summary (Optional)</h3>
      <textarea id="summaryInput" rows="4" placeholder="Finalize patient-facing summary...">${safe(summaryDraft)}</textarea>
      <div class="composer-actions">
        <button data-action="save-summary" class="ghost">Save Summary</button>
        <button data-action="save-close" class="primary">Save & Close Case</button>
      </div>
    </section>
  `;
}

function render() {
  renderQueue();
  renderDetail();
}

function setStreamState(text, isLive) {
  streamStateEl.textContent = text;
  streamDotEl.classList.toggle("live", isLive);
}

async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function loadCases() {
  const payload = await api("/api/specialist/cases");
  state.cases = payload.cases || [];
  state.selectedCaseId = state.cases[0]?.id || null;
  render();
}

function connectStream() {
  const stream = new EventSource("/api/specialist/stream");

  stream.addEventListener("connected", () => {
    setStreamState("Live updates connected", true);
  });

  stream.addEventListener("case_updated", (event) => {
    const caseItem = JSON.parse(event.data);
    upsertCase(caseItem);
    render();
  });

  stream.onerror = () => {
    setStreamState("Reconnecting...", false);
  };
}

async function setStatus(status) {
  const caseItem = selectedCase();

  if (!caseItem) {
    return;
  }

  await api(`/api/specialist/cases/${caseItem.id}/status`, "PATCH", { status });
}

async function requestClarification() {
  const caseItem = selectedCase();

  if (!caseItem) {
    return;
  }

  const text = String(document.getElementById("clarificationInput")?.value || "").trim();

  if (!text) {
    alert("Write a clarification request first.");
    return;
  }

  await api(`/api/specialist/cases/${caseItem.id}/request-clarification`, "POST", { text });
}

async function sendAdvice() {
  const caseItem = selectedCase();

  if (!caseItem) {
    return;
  }

  const text = String(document.getElementById("adviceInput")?.value || "").trim();
  const carePathway = String(document.getElementById("carePathwaySelect")?.value || "").trim();

  if (!text) {
    alert("Write reviewed advice before sending.");
    return;
  }

  await api(`/api/specialist/cases/${caseItem.id}/advice`, "POST", {
    text,
    carePathway,
  });
}

async function saveSummary(closeCase) {
  const caseItem = selectedCase();

  if (!caseItem) {
    return;
  }

  const text = String(document.getElementById("summaryInput")?.value || "").trim();

  if (!text) {
    alert("Write a final follow-up summary first.");
    return;
  }

  await api(`/api/specialist/cases/${caseItem.id}/final-summary`, "POST", {
    text,
    closeCase,
  });
}

document.addEventListener("click", async (event) => {
  const queueButton = event.target.closest(".queue-card");

  if (queueButton?.dataset.caseId) {
    state.selectedCaseId = queueButton.dataset.caseId;
    render();
    return;
  }

  const actionEl = event.target.closest("[data-action]");

  if (!actionEl) {
    return;
  }

  const action = actionEl.dataset.action;

  try {
    if (action === "set-under-review") {
      await setStatus("under_review");
      return;
    }

    if (action === "request-clarification") {
      await requestClarification();
      return;
    }

    if (action === "send-advice") {
      await sendAdvice();
      return;
    }

    if (action === "save-summary") {
      await saveSummary(false);
      return;
    }

    if (action === "save-close") {
      await saveSummary(true);
    }
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
});

async function init() {
  setStreamState("Connecting...", false);
  await loadCases();
  connectStream();
}

init().catch((error) => {
  console.error(error);
  setStreamState(error.message || "Failed to load specialist dashboard", false);
});
