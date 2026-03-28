const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
const partialTranscriptEl = document.getElementById("partialTranscript");
const committedTranscriptEl = document.getElementById("committedTranscript");
const eventLogEl = document.getElementById("eventLog");
const connectionStateEl = document.getElementById("connectionState");
const sampleRateEl = document.getElementById("sampleRate");
const liveDotEl = document.getElementById("liveDot");

let audioContext;
let mediaStream;
let mediaStreamSource;
let processorNode;
let ws;
let committedSegments = [];
let hasSentAudio = false;

function setConnectionState(state) {
  connectionStateEl.textContent = state;
}

function appendEvent(message) {
  const item = document.createElement("div");
  item.className = "event-item";
  item.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  eventLogEl.prepend(item);

  while (eventLogEl.children.length > 12) {
    eventLogEl.removeChild(eventLogEl.lastChild);
  }
}

function renderCommittedTranscript() {
  if (committedSegments.length === 0) {
    committedTranscriptEl.innerHTML = '<p class="segment">Committed transcript segments will appear here.</p>';
    return;
  }

  committedTranscriptEl.innerHTML = "";
  for (const segment of committedSegments) {
    const el = document.createElement("p");
    el.className = "segment";
    el.textContent = segment;
    committedTranscriptEl.appendChild(el);
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
      appendEvent("Realtime session started.");
      return;
    case "partial_transcript":
      partialTranscriptEl.textContent = data.text || "";
      return;
    case "committed_transcript":
      if (data.text) {
        committedSegments.push(data.text);
        renderCommittedTranscript();
        partialTranscriptEl.textContent = "Waiting for more speech...";
      }
      return;
    case "committed_transcript_with_timestamps":
      appendEvent(`Committed transcript with ${data.words?.length || 0} timestamped items.`);
      return;
    default:
      if (data.type || data.error || data.message) {
        appendEvent(`Server event: ${data.type || data.message_type || "unknown"}`);
      }
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

  sampleRateEl.textContent = "16000 Hz";

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
        ...(hasSentAudio ? {} : { previous_text: "Live microphone transcription." }),
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
  startButton.disabled = false;
  stopButton.disabled = true;
  liveDotEl.classList.remove("live");
  setConnectionState("Stopped");

  await stopAudioPipeline();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  ws = null;
  hasSentAudio = false;
}

async function startTranscription() {
  startButton.disabled = true;
  stopButton.disabled = false;
  setConnectionState("Connecting");
  liveDotEl.classList.add("live");
  partialTranscriptEl.textContent = "Requesting microphone permission and ElevenLabs token...";

  try {
    const token = await fetchScribeToken();
    const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("include_timestamps", "true");
    url.searchParams.set("token", token);

    ws = new WebSocket(url);
    ws.addEventListener("message", handleSocketMessage);
    ws.addEventListener("error", () => {
      appendEvent("WebSocket error.");
      partialTranscriptEl.textContent = "Connection error. Check the event log.";
    });
    ws.addEventListener("close", () => {
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
          appendEvent("WebSocket opened.");
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
  } catch (error) {
    console.error(error);
    appendEvent(error.message);
    partialTranscriptEl.textContent = error.message;
    await stopTranscription();
  }
}

startButton.addEventListener("click", () => {
  startTranscription();
});

stopButton.addEventListener("click", () => {
  stopTranscription();
});

clearButton.addEventListener("click", () => {
  committedSegments = [];
  partialTranscriptEl.textContent = "Start recording to see interim words appear here.";
  renderCommittedTranscript();
  eventLogEl.innerHTML = "";
});

renderCommittedTranscript();
