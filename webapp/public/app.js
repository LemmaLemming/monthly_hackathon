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
let sessionCommittedText = "";
let bubbleBaseline = "";
let consultationMessageIds = new Set();

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
    bubbleBaseline = sessionCommittedText;
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
  if (bubbleBaseline && incoming.startsWith(bubbleBaseline)) {
    return incoming.slice(bubbleBaseline.length).trimStart();
  }
  if (bubbleBaseline) return "";
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
  return `Summarize the following emergency call transcript.

Use short, incomplete sentence states.

Return only these headings in this exact order:
Patient Profile
Chief Complaint
Duration
Pain Radiation
Associated Symptoms
Potential Mimics
Current Status

If information is missing, leave the heading in place and write "Unknown".

Transcript:
${transcript}`;
}

async function generateGeminiSummary(prompt) {
  const response = await fetch("/api/ai/summary", {
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
  const response = await fetch("/api/consultation/messages", {
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
  const response = await fetch("/api/consultation/history");
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
  sessionCommittedText = "";
  bubbleBaseline = "";
}

async function startTranscription() {
  transcriptionToggleButton.textContent = "Stop Transcription";
  setConnectionState("Connecting");
  liveDotEl.classList.add("live");
  sessionCommittedText = "";
  bubbleBaseline = "";

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
  sessionCommittedText = "";
  bubbleBaseline = "";
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

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const isEditingBubble =
    activeElement && activeElement.classList && activeElement.classList.contains("bubble-edit");
  const isTypingConsultation = activeElement === physicianReplyInput;

  if (event.code !== "Space" || isEditingBubble || isTypingConsultation) {
    return;
  }

  event.preventDefault();
  toggleSpeaker();
});

setActiveSpeaker(currentSpeaker);
ensureEmptyState();
loadConsultationHistory();
connectConsultationStream();
