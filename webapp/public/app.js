const transcriptionToggleButton = document.getElementById("transcriptionToggle");
const transcriptStreamEl = document.getElementById("transcriptStream");
const connectionStateEl = document.getElementById("connectionState");
const sampleRateEl = document.getElementById("sampleRate");
const liveDotEl = document.getElementById("liveDot");
const activeSpeakerLabelEl = document.getElementById("activeSpeakerLabel");
const operatorQueueEl = document.getElementById("operatorQueue");
const operatorDetailEl = document.getElementById("operatorDetail");

let audioContext;
let mediaStream;
let mediaStreamSource;
let processorNode;
let ws;
let hasSentAudio = false;
let isTranscribing = false;
let currentSpeaker = "patient";
let draftMessage = null;
let transcriptHistory = "";
const operatorState = {
  cases: [],
  selectedCaseId: null,
};

function setConnectionState(state) {
  connectionStateEl.textContent = state;
}

function setActiveSpeaker(speaker) {
  currentSpeaker = speaker;
  activeSpeakerLabelEl.textContent = speaker === "patient" ? "Patient" : "Dispatcher";
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function ensureEmptyState() {
  if (transcriptStreamEl.children.length > 0) {
    return;
  }

  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.id = "emptyState";
  emptyState.textContent = "Start transcription to build the live patient and dispatcher transcript.";
  transcriptStreamEl.appendChild(emptyState);
}

function removeEmptyState() {
  const emptyState = document.getElementById("emptyState");
  if (emptyState) {
    emptyState.remove();
  }
}

function scrollTranscriptToBottom() {
  transcriptStreamEl.scrollTop = transcriptStreamEl.scrollHeight;
}

function placeCaretFromPoint(editableElement, x, y) {
  editableElement.focus();

  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position && editableElement.contains(position.offsetNode)) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }

  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && editableElement.contains(range.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }

  const fallbackRange = document.createRange();
  fallbackRange.selectNodeContents(editableElement);
  fallbackRange.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(fallbackRange);
}

function attachEditableBehavior(editableElement) {
  editableElement.addEventListener("mousedown", (event) => {
    placeCaretFromPoint(editableElement, event.clientX, event.clientY);
    event.preventDefault();
  });
}

function createMessageBubble(speaker) {
  removeEmptyState();

  const row = document.createElement("article");
  row.className = `message-row ${speaker}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble-edit ${speaker} live`;
  bubble.contentEditable = "true";
  bubble.spellcheck = true;
  bubble.dataset.speaker = speaker;
  bubble.textContent = "";
  attachEditableBehavior(bubble);

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const timestamp = document.createElement("span");
  timestamp.className = "timestamp";
  timestamp.textContent = formatTimestamp();

  const role = document.createElement("span");
  role.className = "role-live";
  role.textContent = speaker === "patient" ? "Patient (Live)" : "Dispatcher (Live)";

  meta.append(timestamp, role);
  row.append(bubble, meta);
  transcriptStreamEl.appendChild(row);
  scrollTranscriptToBottom();

  return {
    speaker,
    row,
    bubble,
    timestamp,
    role,
  };
}

function finalizeDraftMessage() {
  if (!draftMessage) {
    return;
  }

  draftMessage.bubble.classList.remove("live");
  draftMessage.role.textContent = draftMessage.speaker === "patient" ? "Patient" : "Dispatcher";
  draftMessage = null;
}

function createSwitchNote(nextSpeaker) {
  removeEmptyState();

  const note = document.createElement("p");
  note.className = "switch-note";
  note.textContent =
    nextSpeaker === "dispatcher"
      ? "Switched to Dispatcher, press SPACE to switch back."
      : "Switched to Patient, press SPACE to switch back.";
  transcriptStreamEl.appendChild(note);
  scrollTranscriptToBottom();
}

function ensureDraftMessage() {
  if (!draftMessage || draftMessage.speaker !== currentSpeaker) {
    finalizeDraftMessage();
    draftMessage = createMessageBubble(currentSpeaker);
  }

  return draftMessage;
}

function updateDraftText(text) {
  const message = ensureDraftMessage();
  message.bubble.textContent = text || "";
  message.timestamp.textContent = formatTimestamp();
  scrollTranscriptToBottom();
}

function appendCommittedText(text) {
  if (!text) {
    return;
  }

  const message = ensureDraftMessage();
  message.bubble.textContent = text;
  message.timestamp.textContent = formatTimestamp();
  scrollTranscriptToBottom();
}

function normalizeIncomingTranscript(text) {
  const incoming = (text || "").trim();
  const history = transcriptHistory.trim();

  if (!incoming) {
    return "";
  }

  if (history && incoming.startsWith(history)) {
    return incoming.slice(history.length).trimStart();
  }

  return incoming;
}

function rememberCommittedTranscript(text) {
  const normalized = normalizeIncomingTranscript(text);

  if (!normalized) {
    return;
  }

  transcriptHistory = transcriptHistory
    ? `${transcriptHistory} ${normalized}`.trim()
    : normalized;
}

function safeText(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function selectedOperatorCase() {
  return operatorState.cases.find((item) => item.id === operatorState.selectedCaseId) || null;
}

function upsertOperatorCase(updatedCase) {
  const index = operatorState.cases.findIndex((item) => item.id === updatedCase.id);

  if (index === -1) {
    operatorState.cases.push(updatedCase);
  } else {
    operatorState.cases[index] = updatedCase;
  }

  operatorState.cases.sort((a, b) => b.updatedAt - a.updatedAt);

  if (!operatorState.selectedCaseId) {
    operatorState.selectedCaseId = operatorState.cases[0]?.id || null;
  }
}

function renderOperatorQueue() {
  if (!operatorQueueEl) {
    return;
  }

  if (operatorState.cases.length === 0) {
    operatorQueueEl.innerHTML = '<p class="empty-state">No escalated specialist cases yet.</p>';
    return;
  }

  operatorQueueEl.innerHTML = operatorState.cases
    .map((item) => {
      const isSelected = item.id === operatorState.selectedCaseId ? "selected" : "";

      return `
        <button class="op-queue-item ${isSelected}" data-op-case-id="${safeText(item.id)}">
          <div class="op-queue-top">
            <span class="op-urgency-pill">${safeText(item.urgency)}</span>
            <span>${safeText(item.waitingMinutes)} min</span>
          </div>
          <strong>${safeText(item.patientName)}</strong>
          <p>${safeText(item.chiefConcern)}</p>
          <div class="op-queue-foot">
            <span>${safeText(item.id)}</span>
            <span class="op-status-pill ${safeText(item.status)}">${safeText(
              String(item.status).replaceAll("_", " "),
            )}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderOperatorThread(caseItem) {
  if (!Array.isArray(caseItem.messages) || caseItem.messages.length === 0) {
    return '<p class="empty-state">No messages yet.</p>';
  }

  return [...caseItem.messages]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((message) => {
      const roleClass = message.sender === "specialist" ? "specialist" : "operator";
      const time = new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      return `
        <article class="operator-thread-row ${roleClass}">
          <div class="operator-thread-meta">
            <strong>${safeText(message.sender)}</strong>
            <span>${safeText(message.kind)}</span>
            <span>${safeText(time)}</span>
          </div>
          <p>${safeText(message.text)}</p>
        </article>
      `;
    })
    .join("");
}

function renderOperatorDetail() {
  if (!operatorDetailEl) {
    return;
  }

  const caseItem = selectedOperatorCase();

  if (!caseItem) {
    operatorDetailEl.innerHTML = '<p class="empty-state">Select an escalated case to communicate.</p>';
    return;
  }

  operatorDetailEl.innerHTML = `
    <div class="op-detail-head">
      <div>
        <strong>${safeText(caseItem.patientName)}</strong>
        <p>${safeText(caseItem.id)} • ${safeText(caseItem.patientAge)}${safeText(caseItem.sex)}</p>
      </div>
      <div>
        <span class="op-urgency-pill">${safeText(caseItem.urgency)}</span>
        <span class="op-status-pill ${safeText(caseItem.status)}">${safeText(
          String(caseItem.status).replaceAll("_", " "),
        )}</span>
      </div>
    </div>

    <section class="op-block">
      <h3>Specialist Reviewed Advice</h3>
      <p>${safeText(caseItem.reviewedAdvice || "No reviewed advice sent yet.")}</p>
    </section>

    <section class="op-block">
      <h3>Selected Care Pathway</h3>
      <p>${safeText(caseItem.selectedCarePathway || "Not selected yet.")}</p>
    </section>

    <section class="op-block">
      <h3>Two-Way Communication</h3>
      <div class="operator-thread">${renderOperatorThread(caseItem)}</div>
      <textarea class="operator-input" id="operatorQuestionInput" placeholder="Ask specialist for review or reply with clarification..."></textarea>
      <div class="operator-actions">
        <button class="ghost" data-op-action="send-question">Send Question</button>
        <button class="ghost" data-op-action="send-clarification">Send Clarification Reply</button>
        <button class="ghost" data-op-action="mark-closed">Close Case</button>
      </div>
    </section>
  `;
}

function renderOperatorPanel() {
  renderOperatorQueue();
  renderOperatorDetail();
}

async function operatorApi(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Operator workflow request failed.");
  }

  return payload;
}

async function loadOperatorCases() {
  if (!operatorQueueEl || !operatorDetailEl) {
    return;
  }

  const payload = await operatorApi("/api/specialist/cases");
  operatorState.cases = payload.cases || [];
  operatorState.selectedCaseId = operatorState.cases[0]?.id || null;
  renderOperatorPanel();
}

function connectOperatorStream() {
  if (!operatorQueueEl || !operatorDetailEl) {
    return;
  }

  const stream = new EventSource("/api/specialist/stream");

  stream.addEventListener("case_updated", (event) => {
    const caseItem = JSON.parse(event.data);
    upsertOperatorCase(caseItem);
    renderOperatorPanel();
  });
}

async function postOperatorMessage(kind) {
  const caseItem = selectedOperatorCase();

  if (!caseItem) {
    return;
  }

  const inputEl = document.getElementById("operatorQuestionInput");
  const text = String(inputEl?.value || "").trim();

  if (!text) {
    alert("Write a message first.");
    return;
  }

  await operatorApi(`/api/specialist/cases/${caseItem.id}/messages`, "POST", {
    sender: "operator",
    kind,
    text,
  });

  if (inputEl) {
    inputEl.value = "";
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function downsampleBuffer(buffer, inputSampleRate, targetSampleRate) {
  if (targetSampleRate === inputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }

    result[offsetResult] = accum / count;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPCM(float32Buffer) {
  const output = new DataView(new ArrayBuffer(float32Buffer.length * 2));
  let offset = 0;

  for (let i = 0; i < float32Buffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Buffer[i]));
    output.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return output.buffer;
}

async function fetchScribeToken() {
  const response = await fetch("/scribe-token");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to fetch scribe token.");
  }

  if (!payload.token) {
    throw new Error("Token response did not include a token field.");
  }

  return payload.token;
}

function handleSocketMessage(event) {
  const data = JSON.parse(event.data);

  switch (data.message_type) {
    case "session_started":
      setConnectionState("Listening");
      return;
    case "partial_transcript":
      updateDraftText(normalizeIncomingTranscript(data.text || ""));
      return;
    case "committed_transcript":
      appendCommittedText(normalizeIncomingTranscript(data.text || ""));
      rememberCommittedTranscript(data.text || "");
      finalizeDraftMessage();
      return;
    case "committed_transcript_with_timestamps":
      if (data.text) {
        appendCommittedText(normalizeIncomingTranscript(data.text));
        rememberCommittedTranscript(data.text);
        finalizeDraftMessage();
      }
      return;
    default:
  }
}

async function startAudioPipeline() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  audioContext = new AudioContext();
  await audioContext.resume();
  mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);

  sampleRateEl.textContent = "16000 Hz mono PCM";

  processorNode.onaudioprocess = (audioProcessingEvent) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
    const pcmBuffer = floatTo16BitPCM(downsampled);

    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: arrayBufferToBase64(pcmBuffer),
        sample_rate: 16000,
        ...(hasSentAudio ? {} : { previous_text: "Emergency call transcription." }),
      }),
    );

    hasSentAudio = true;
  };

  mediaStreamSource.connect(processorNode);
  processorNode.connect(audioContext.destination);
}

async function stopAudioPipeline() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
  }

  if (mediaStreamSource) {
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
}

async function stopTranscription() {
  isTranscribing = false;
  transcriptionToggleButton.textContent = "Start Transcription";
  liveDotEl.classList.remove("live");
  setConnectionState("Stopped");

  finalizeDraftMessage();
  await stopAudioPipeline();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  ws = null;
  hasSentAudio = false;
  transcriptHistory = "";
}

async function startTranscription() {
  transcriptionToggleButton.textContent = "Stop Transcription";
  setConnectionState("Connecting");
  liveDotEl.classList.add("live");

  try {
    const token = await fetchScribeToken();
    const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("include_timestamps", "true");
    url.searchParams.set("token", token);

    ws = new WebSocket(url);
    ws.addEventListener("message", handleSocketMessage);
    ws.addEventListener("error", () => {
      setConnectionState("Connection error");
    });
    ws.addEventListener("close", () => {
      if (!isTranscribing) {
        return;
      }

      setConnectionState("Disconnected");
      liveDotEl.classList.remove("live");
    });

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timed out while opening the ElevenLabs WebSocket."));
      }, 10000);

      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true },
      );

      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timeoutId);
          reject(new Error("Failed to open the ElevenLabs WebSocket."));
        },
        { once: true },
      );
    });

    await startAudioPipeline();
    isTranscribing = true;
    setConnectionState("Listening");
  } catch (error) {
    console.error(error);
    setConnectionState(error.message);
    await stopTranscription();
  }
}

function toggleSpeaker() {
  const nextSpeaker = currentSpeaker === "patient" ? "dispatcher" : "patient";
  finalizeDraftMessage();
  setActiveSpeaker(nextSpeaker);
  createSwitchNote(nextSpeaker);
}

transcriptionToggleButton.addEventListener("click", () => {
  if (isTranscribing) {
    stopTranscription();
    return;
  }

  startTranscription();
});

document.addEventListener("click", async (event) => {
  const queueItem = event.target.closest("[data-op-case-id]");

  if (queueItem?.dataset.opCaseId) {
    operatorState.selectedCaseId = queueItem.dataset.opCaseId;
    renderOperatorPanel();
    return;
  }

  const actionEl = event.target.closest("[data-op-action]");

  if (!actionEl) {
    return;
  }

  try {
    if (actionEl.dataset.opAction === "send-question") {
      const caseItem = selectedOperatorCase();

      if (!caseItem) {
        return;
      }

      await operatorApi(`/api/specialist/cases/${caseItem.id}/status`, "PATCH", {
        status: "waiting_for_review",
      });
      await postOperatorMessage("question");
      return;
    }

    if (actionEl.dataset.opAction === "send-clarification") {
      await postOperatorMessage("clarification_reply");
      return;
    }

    if (actionEl.dataset.opAction === "mark-closed") {
      const caseItem = selectedOperatorCase();

      if (!caseItem) {
        return;
      }

      await operatorApi(`/api/specialist/cases/${caseItem.id}/status`, "PATCH", {
        status: "case_closed",
      });
    }
  } catch (error) {
    console.error(error);
    alert(error.message || "Failed to send operator update.");
  }
});

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const isEditingBubble =
    activeElement &&
    activeElement.classList &&
    (activeElement.classList.contains("bubble-edit") ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.tagName === "INPUT" ||
      activeElement.isContentEditable);

  if (event.code !== "Space" || isEditingBubble) {
    return;
  }

  event.preventDefault();
  toggleSpeaker();
});

setActiveSpeaker(currentSpeaker);
ensureEmptyState();
loadOperatorCases().then(connectOperatorStream).catch((error) => {
  console.error(error);
});
