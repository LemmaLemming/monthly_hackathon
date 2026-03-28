const transcriptionToggleButton = document.getElementById("transcriptionToggle");
const transcriptStreamEl = document.getElementById("transcriptStream");
const connectionStateEl = document.getElementById("connectionState");
const sampleRateEl = document.getElementById("sampleRate");
const liveDotEl = document.getElementById("liveDot");
const activeSpeakerLabelEl = document.getElementById("activeSpeakerLabel");

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

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const isEditingBubble =
    activeElement && activeElement.classList && activeElement.classList.contains("bubble-edit");

  if (event.code !== "Space" || isEditingBubble) {
    return;
  }

  event.preventDefault();
  toggleSpeaker();
});

setActiveSpeaker(currentSpeaker);
ensureEmptyState();
