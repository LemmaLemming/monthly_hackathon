const incomingFeedEl = document.getElementById("incomingFeed");
const replyForm = document.getElementById("replyForm");
const replyInput = document.getElementById("replyInput");

let messageIds = new Set();
let consultationStream;

function scrollToBottom() {
  incomingFeedEl.scrollTop = incomingFeedEl.scrollHeight;
}

function renderMessage(message) {
  if (!message?.id || messageIds.has(message.id) || message.author === "physician") {
    return;
  }

  messageIds.add(message.id);

  const item = document.createElement("article");
  item.className = "message-item";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
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

loadHistory();
connectStream();
