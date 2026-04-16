const logoutButton = document.getElementById("logoutButton");
const sessionUserLabel = document.getElementById("sessionUserLabel");
const transcriptionToggleButton = document.getElementById("transcriptionToggle");
const transcriptStreamEl = document.getElementById("transcriptStream");
const connectionStateEl = document.getElementById("connectionState");
const sampleRateEl = document.getElementById("sampleRate");
const liveDotEl = document.getElementById("liveDot");
const activeSpeakerLabelEl = document.getElementById("activeSpeakerLabel");
const summaryButton = document.getElementById("summaryButton");
const summaryOutput = document.getElementById("summaryOutput");
const sendSummaryButton = document.getElementById("sendSummaryButton");
const consultationFeedEl = document.getElementById("consultationFeed");
const physicianReplyForm = document.getElementById("physicianReplyForm");
const physicianReplyInput = document.getElementById("physicianReplyInput");
const voiceToTextButton = document.getElementById("voiceToTextButton");
const addPhysicianButton = document.getElementById("addPhysicianButton");
const endCallButton = document.getElementById("endCallButton");
const endCallModal = document.getElementById("endCallModal");
const closeEndCallModalButton = document.getElementById("closeEndCallModalButton");
const followUpOutput = document.getElementById("followUpOutput");
const regenerateFollowUpButton = document.getElementById("regenerateFollowUpButton");
const sendSmsButton = document.getElementById("sendSmsButton");
const smsStatus = document.getElementById("smsStatus");

let audioContext;
let mediaStream;
let mediaStreamSource;
let processorNode;
let ws;
let consultationStream;
let hasSentAudio = false;
let isTranscribing = false;
let currentSpeaker = "patient";
let draftMessage = null;
let previousBubbleText = "";
let sessionCommittedText = "";
let consultationMessageIds = new Set();
let currentSession = null;
let sessionVerificationPromise = null;

function getLoginRedirectTarget() {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/?next=${encodeURIComponent(next)}`;
}

async function readJsonResponse(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return { error: rawBody };
  }
}

async function stopConsultationStream() {
  if (consultationStream) {
    consultationStream.close();
    consultationStream = null;
  }
}

async function teardownAuthenticatedState() {
  await stopConsultationStream();

  if (isTranscribing) {
    await stopTranscription();
  }

  closeEndCallModal();
  setConnectionState("Idle");
  liveDotEl.classList.remove("live");
}

async function handleSignedOut() {
  await teardownAuthenticatedState();
  currentSession = null;
  window.location.replace(getLoginRedirectTarget());
}

async function authFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });

  if (response.status === 401) {
    await readJsonResponse(response);
    await handleSignedOut();
    throw new Error("Authentication required.");
  }

  if (response.status === 503) {
    await readJsonResponse(response);
    await handleSignedOut();
    throw new Error("Login is unavailable.");
  }

  return response;
}

async function verifyActiveSession() {
  if (sessionVerificationPromise) {
    return sessionVerificationPromise;
  }

  sessionVerificationPromise = (async () => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
      });
      const payload = await readJsonResponse(response);

      if (response.ok) {
        currentSession = payload;
        sessionUserLabel.textContent = `Signed in as ${payload.username}`;
        return true;
      }

      if (response.status === 401) {
        await handleSignedOut();
        return false;
      }

      await handleSignedOut();
      return false;
    } catch (error) {
      console.error(error);
      return true;
    }
  })().finally(() => {
    sessionVerificationPromise = null;
  });

  return sessionVerificationPromise;
}

async function loadCurrentSession() {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const payload = await readJsonResponse(response);

    if (response.ok) {
      sessionUserLabel.textContent = `Signed in as ${payload.username}`;
      return payload;
    }

    await handleSignedOut();
    return null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function enterAuthenticatedApp(session) {
  currentSession = session;
  sessionUserLabel.textContent = `Signed in as ${session.username}`;
  await loadConsultationHistory();
  connectConsultationStream();
}

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

function scrollConsultationToBottom() {
  consultationFeedEl.scrollTop = consultationFeedEl.scrollHeight;
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
  role.className = "speaker-label role-live";
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
  if (!incoming) return "";
  if (sessionCommittedText && incoming.startsWith(sessionCommittedText)) {
    return incoming.slice(sessionCommittedText.length).trimStart();
  }
  return incoming;
}

function rememberCommittedTranscript(text) {
  sessionCommittedText = (text || "").trim();
}

function getTranscriptForSummary() {
  const messageRows = Array.from(transcriptStreamEl.querySelectorAll(".message-row"));

  return messageRows
    .map((row) => {
      const speaker = row.querySelector(".speaker-label")?.textContent?.replace(" (Live)", "") || "Unknown";
      const timestamp = row.querySelector(".timestamp")?.textContent || "";
      const content = row.querySelector(".bubble-edit")?.textContent?.trim() || "";

      if (!content) {
        return "";
      }

      return `${timestamp} ${speaker}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildSummaryPrompt(transcript) {
  return `Role: Act as a Clinical Scribe.

Task: Analyze the following live emergency call transcript. Instead of answering questions, extract all medical data into a single, condensed summary block.

Constraints:

Style: Use shorthand and clinical fragments. Do not use full sentences or conversational filler.

Terminology: Map symptoms to clinical terms where appropriate (e.g., if the patient says "breathing fast," use "tachypnea").

Categorization: If a symptom suggests a specific body system, note it in parentheses (e.g., "Spicy food (GI)").

Formatting: Separate items with commas or semicolons. Do not include the original questions asked by the dispatcher; focus only on the gathered data.

Transcript:
${transcript}`;
}

function buildFollowUpPrompt(transcript) {
  return `You are helping an emergency dispatcher close a call.

Based on the transcript below, write a concise patient-facing follow-up message that can be sent by SMS.

Requirements:
- Plain language.
- 4 to 6 short bullet points.
- Focus on immediate next steps only.
- Include when to call emergency services again.
- Do not mention internal clinical reasoning.
- Do not use markdown headings.

Transcript:
${transcript}`;
}

async function generateGeminiSummary(prompt) {
  const response = await authFetch("/api/ai/summary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(
      response.ok
        ? "Summary service returned an invalid response."
        : `Summary service error (${response.status}): ${rawBody.slice(0, 160) || "Empty response."}`,
    );
  }

  if (!response.ok) {
    throw new Error(payload.error || "Failed to generate Gemini summary.");
  }

  return payload.summary || "";
}

async function summarizeConversation() {
  const transcript = getTranscriptForSummary();

  if (!transcript) {
    summaryOutput.value =
      "Patient Profile\nUnknown\n\nChief Complaint\nUnknown\n\nDuration\nUnknown\n\nPain Radiation\nUnknown\n\nAssociated Symptoms\nUnknown\n\nPotential Mimics\nUnknown\n\nCurrent Status\nUnknown";
    return;
  }

  summaryButton.disabled = true;
  summaryButton.textContent = "Generating Summary...";

  try {
    const prompt = buildSummaryPrompt(transcript);
    const summary = await generateGeminiSummary(prompt);
    summaryOutput.value = summary || "No summary returned.";
  } catch (error) {
    console.error(error);
    summaryOutput.value = `Summary failed: ${error.message}`;
  } finally {
    summaryButton.disabled = false;
    summaryButton.textContent = "Generate AI Summary";
  }
}

async function postConsultationMessage(payload) {
  const response = await authFetch("/api/consultation/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unable to send message." }));
    throw new Error(error.error || "Unable to send message.");
  }

  return response.json();
}

async function sendPatientSms(message) {
  const response = await authFetch("/api/patient/sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error("SMS service returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "Unable to send SMS.");
  }

  return payload;
}

function renderConsultationMessage(message) {
  if (!message?.id || consultationMessageIds.has(message.id)) {
    return;
  }

  consultationMessageIds.add(message.id);

  const item = document.createElement("article");
  item.className = `consultation-message ${message.author}`;

  const bubble = document.createElement("div");
  bubble.className = `consultation-bubble ${message.author}`;

  if (message.kind === "summary") {
    bubble.classList.add("summary");
  }

  bubble.textContent = message.text;

  const meta = document.createElement("div");
  meta.className = "consultation-meta";
  meta.textContent = `${message.timestamp} | ${message.role}`;

  item.append(bubble, meta);
  consultationFeedEl.appendChild(item);
  scrollConsultationToBottom();
}

async function loadConsultationHistory() {
  const response = await authFetch("/api/consultation/history");
  const payload = await response.json();
  consultationFeedEl.innerHTML = "";
  consultationMessageIds = new Set();
  payload.messages.forEach(renderConsultationMessage);
}

function connectConsultationStream() {
  if (consultationStream) {
    consultationStream.close();
  }

  consultationStream = new EventSource("/api/consultation/stream?client=dispatcher");
  consultationStream.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    renderConsultationMessage(payload);
  });
  consultationStream.addEventListener("error", async () => {
    if (!currentSession) {
      return;
    }

    await verifyActiveSession();
  });
}

async function sendSummaryToPhysician() {
  const text = summaryOutput.value.trim();
  if (!text) {
    return;
  }

  sendSummaryButton.disabled = true;

  try {
    await postConsultationMessage({
      author: "dispatcher",
      role: "Dispatcher",
      kind: "summary",
      text,
    });
  } catch (error) {
    console.error(error);
  } finally {
    sendSummaryButton.disabled = false;
  }
}

async function sendDispatcherReply(text) {
  const message = text.trim();
  if (!message) {
    return;
  }

  await postConsultationMessage({
    author: "dispatcher",
    role: "Dispatcher",
    kind: "message",
    text: message,
  });
}

function openEndCallModal() {
  endCallModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeEndCallModal() {
  endCallModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function generateFollowUpSummary() {
  const transcript = getTranscriptForSummary();

  if (!transcript) {
    followUpOutput.value =
      "- Stay where you are and keep your phone nearby.\n- Follow any dispatcher instructions already provided.\n- If symptoms get worse, call emergency services again immediately.\n- Do not drive yourself if chest pain, trouble breathing, or dizziness continues.";
    return;
  }

  regenerateFollowUpButton.disabled = true;
  sendSmsButton.disabled = true;
  smsStatus.textContent = "Generating follow-up instructions...";

  try {
    const prompt = buildFollowUpPrompt(transcript);
    const summary = await generateGeminiSummary(prompt);
    followUpOutput.value = summary || "No follow-up instructions returned.";
    smsStatus.textContent = "Follow-up instructions ready.";
  } catch (error) {
    console.error(error);
    followUpOutput.value = `Follow-up generation failed: ${error.message}`;
    smsStatus.textContent = "Follow-up generation failed.";
  } finally {
    regenerateFollowUpButton.disabled = false;
    sendSmsButton.disabled = false;
  }
}

async function handleEndCall() {
  if (isTranscribing) {
    await stopTranscription();
  }

  smsStatus.textContent = "Generating follow-up instructions...";
  openEndCallModal();
  await generateFollowUpSummary();
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
  const response = await authFetch("/scribe-token");
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
  sessionCommittedText = "";
  previousBubbleText = "";
}

async function startTranscription() {
  transcriptionToggleButton.textContent = "Stop Transcription";
  setConnectionState("Connecting");
  liveDotEl.classList.add("live");
  sessionCommittedText = "";
  previousBubbleText = "";

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

  previousBubbleText = draftMessage ? draftMessage.bubble.textContent.trim() : "";

  finalizeDraftMessage();
  setActiveSpeaker(nextSpeaker);
  createSwitchNote(nextSpeaker);

  draftMessage = createMessageBubble(currentSpeaker);

  setTimeout(() => {
    if (!draftMessage) return;
    const current = draftMessage.bubble.textContent.trim();
    if (previousBubbleText && current.startsWith(previousBubbleText)) {
      const stripped = current.slice(previousBubbleText.length).trimStart();
      draftMessage.bubble.textContent = stripped;
      sessionCommittedText = stripped;
    } else {
      sessionCommittedText = "";
    }
    previousBubbleText = "";
  }, 300);
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (error) {
    console.error(error);
  } finally {
    await teardownAuthenticatedState();
    currentSession = null;
    logoutButton.disabled = false;
    window.location.assign("/");
  }
});

transcriptionToggleButton.addEventListener("click", () => {
  if (isTranscribing) {
    stopTranscription();
    return;
  }

  startTranscription();
});

summaryButton.addEventListener("click", () => {
  summarizeConversation();
});

sendSummaryButton.addEventListener("click", () => {
  sendSummaryToPhysician();
});

physicianReplyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = physicianReplyInput.value;
  physicianReplyInput.value = "";

  try {
    await sendDispatcherReply(value);
  } catch (error) {
    console.error(error);
    physicianReplyInput.value = value;
  }
});

voiceToTextButton.addEventListener("click", () => {
  physicianReplyInput.value = `${physicianReplyInput.value}${physicianReplyInput.value ? " " : ""}[Voice note placeholder]`;
  physicianReplyInput.focus();
});

addPhysicianButton.addEventListener("click", () => {
  window.open("/physicians-portal/", "_blank", "noopener,noreferrer");
});

endCallButton.addEventListener("click", async () => {
  await handleEndCall();
});

closeEndCallModalButton.addEventListener("click", () => {
  closeEndCallModal();
});

endCallModal.addEventListener("click", (event) => {
  if (event.target === endCallModal) {
    closeEndCallModal();
  }
});

regenerateFollowUpButton.addEventListener("click", async () => {
  await generateFollowUpSummary();
});

sendSmsButton.addEventListener("click", async () => {
  const message = followUpOutput.value.trim();
  if (!message) {
    smsStatus.textContent = "Nothing to send.";
    return;
  }

  sendSmsButton.disabled = true;
  smsStatus.textContent = "Sending SMS...";

  try {
    const payload = await sendPatientSms(message);
    smsStatus.textContent = payload.status || "SMS sent.";
  } catch (error) {
    console.error(error);
    smsStatus.textContent = `SMS failed: ${error.message}`;
  } finally {
    sendSmsButton.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const isEditingBubble =
    activeElement && activeElement.classList && activeElement.classList.contains("bubble-edit");
  const isTypingConsultation = activeElement === physicianReplyInput;
  const isTypingInput =
    activeElement &&
    (activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable);

  if (event.code === "Escape" && !endCallModal.hidden) {
    closeEndCallModal();
    return;
  }

  if (event.code !== "Space" || isEditingBubble || isTypingConsultation || isTypingInput) {
    return;
  }

  event.preventDefault();
  toggleSpeaker();
});

async function bootstrapApp() {
  setActiveSpeaker(currentSpeaker);
  ensureEmptyState();

  const session = await loadCurrentSession();
  if (!session) {
    return;
  }

  try {
    await enterAuthenticatedApp(session);
  } catch (error) {
    console.error(error);
  }
}

bootstrapApp();
