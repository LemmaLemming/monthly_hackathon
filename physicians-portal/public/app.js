const incomingFeedEl = document.getElementById("incomingFeed");
const replyForm = document.getElementById("replyForm");
const replyInput = document.getElementById("replyInput");
const voiceTypingButton = document.getElementById("voiceTypingButton");
const voiceTypingStatus = document.getElementById("voiceTypingStatus");

let messageIds = new Set();
let consultationStream;
let dictationSocket;
let audioContext;
let mediaStream;
let mediaStreamSource;
let processorNode;
let hasSentAudio = false;
let isDictating = false;
let dictationCommittedText = "";
let dictationBubbleBaseline = "";
let draftVoiceNotePrefix = "";

function scrollToBottom() {
  incomingFeedEl.scrollTop = incomingFeedEl.scrollHeight;
}

function setVoiceTypingState(label, active = false) {
  voiceTypingStatus.textContent = label;
  voiceTypingButton.textContent = active ? "Stop Voice Typing" : "Start Voice Typing";
}

function renderMessage(message) {
  if (!message?.id || messageIds.has(message.id)) {
    return;
  }

  messageIds.add(message.id);

  const item = document.createElement("article");
  item.className = `message-item ${message.author}`;

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${message.author}`;
  if (message.kind === "summary") {
    bubble.classList.add("summary");
  }
  bubble.textContent = message.text;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${message.timestamp} | ${message.role}`;

  item.append(bubble, meta);
  incomingFeedEl.appendChild(item);
  scrollToBottom();
}

async function loadHistory() {
  const response = await fetch("/api/consultation/history");
  const payload = await response.json();
  incomingFeedEl.innerHTML = "";
  messageIds = new Set();
  payload.messages.forEach(renderMessage);
}

function connectStream() {
  if (consultationStream) {
    consultationStream.close();
  }

  consultationStream = new EventSource("/api/consultation/stream?client=physician");
  consultationStream.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    renderMessage(payload);
  });
}

async function sendResponse(text) {
  const response = await fetch("/api/consultation/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: "physician",
      role: "Dr. Aris Thorne",
      kind: "message",
      text,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to send physician response.");
  }
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

function normalizeIncomingTranscript(text) {
  const incoming = (text || "").trim();
  if (!incoming) return "";
  if (dictationBubbleBaseline && incoming.startsWith(dictationBubbleBaseline)) {
    return incoming.slice(dictationBubbleBaseline.length).trimStart();
  }
  if (dictationBubbleBaseline) return "";
  return incoming;
}

function updateReplyInputFromDictation(text) {
  const nextText = [draftVoiceNotePrefix, text].filter(Boolean).join(draftVoiceNotePrefix && text ? " " : "");
  replyInput.value = nextText;
}

function handleDictationMessage(event) {
  const data = JSON.parse(event.data);

  switch (data.message_type) {
    case "session_started":
      setVoiceTypingState("Voice typing live. Listening through ElevenLabs.", true);
      return;
    case "partial_transcript":
      updateReplyInputFromDictation(normalizeIncomingTranscript(data.text || ""));
      return;
    case "committed_transcript":
      updateReplyInputFromDictation(normalizeIncomingTranscript(data.text || ""));
      dictationCommittedText = (data.text || "").trim();
      dictationBubbleBaseline = dictationCommittedText;
      return;
    case "committed_transcript_with_timestamps":
      if (data.text) {
        updateReplyInputFromDictation(normalizeIncomingTranscript(data.text));
        dictationCommittedText = data.text.trim();
        dictationBubbleBaseline = dictationCommittedText;
      }
      return;
    default:
  }
}

async function startDictationAudioPipeline() {
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

  processorNode.onaudioprocess = (audioProcessingEvent) => {
    if (!dictationSocket || dictationSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
    const pcmBuffer = floatTo16BitPCM(downsampled);

    dictationSocket.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: arrayBufferToBase64(pcmBuffer),
        sample_rate: 16000,
        ...(hasSentAudio ? {} : { previous_text: "Physician voice dictation." }),
      }),
    );

    hasSentAudio = true;
  };

  mediaStreamSource.connect(processorNode);
  processorNode.connect(audioContext.destination);
}

async function stopDictationAudioPipeline() {
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

async function stopVoiceTyping() {
  isDictating = false;
  setVoiceTypingState("Voice typing idle.", false);
  await stopDictationAudioPipeline();

  if (dictationSocket && dictationSocket.readyState === WebSocket.OPEN) {
    dictationSocket.close();
  }

  dictationSocket = null;
  hasSentAudio = false;
  dictationCommittedText = "";
  dictationBubbleBaseline = "";
}

async function startVoiceTyping() {
  draftVoiceNotePrefix = replyInput.value.trim();
  dictationCommittedText = "";
  dictationBubbleBaseline = "";
  hasSentAudio = false;
  setVoiceTypingState("Connecting to ElevenLabs voice typing...", true);

  try {
    const token = await fetchScribeToken();
    const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("include_timestamps", "true");
    url.searchParams.set("token", token);

    dictationSocket = new WebSocket(url);
    dictationSocket.addEventListener("message", handleDictationMessage);
    dictationSocket.addEventListener("error", () => {
      setVoiceTypingState("Voice typing connection error.", false);
    });
    dictationSocket.addEventListener("close", () => {
      if (!isDictating) {
        return;
      }

      setVoiceTypingState("Voice typing disconnected.", false);
      isDictating = false;
    });

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timed out while opening the ElevenLabs WebSocket."));
      }, 10000);

      dictationSocket.addEventListener(
        "open",
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true },
      );

      dictationSocket.addEventListener(
        "error",
        () => {
          clearTimeout(timeoutId);
          reject(new Error("Failed to open the ElevenLabs WebSocket."));
        },
        { once: true },
      );
    });

    await startDictationAudioPipeline();
    isDictating = true;
    setVoiceTypingState("Voice typing live. Listening through ElevenLabs.", true);
  } catch (error) {
    console.error(error);
    setVoiceTypingState(error.message, false);
    await stopVoiceTyping();
  }
}

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = replyInput.value.trim();
  if (!value) {
    return;
  }

  replyInput.value = "";

  try {
    await sendResponse(value);
  } catch (error) {
    console.error(error);
    replyInput.value = value;
  }
});

voiceTypingButton.addEventListener("click", async () => {
  if (isDictating) {
    await stopVoiceTyping();
    return;
  }

  await startVoiceTyping();
});

loadHistory();
connectStream();
