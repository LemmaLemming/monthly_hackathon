const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("loginButton");
const loginStatus = document.getElementById("loginStatus");

function setLoginStatus(message, isError = false) {
  loginStatus.textContent = message;
  loginStatus.dataset.state = isError ? "error" : "info";
}

function setLoginAvailability(isEnabled) {
  usernameInput.disabled = !isEnabled;
  passwordInput.disabled = !isEnabled;
  loginButton.disabled = !isEnabled;
}

function getNextPath() {
  const next = new URLSearchParams(window.location.search).get("next") || "";

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "";
  }

  return next;
}

function getPostLoginTarget() {
  return getNextPath() || "/dispatcher";
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

async function bootstrapLogin() {
  setLoginStatus("Checking session...");

  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const payload = await readJsonResponse(response);

    if (response.ok) {
      window.location.replace(getPostLoginTarget());
      return;
    }

    if (response.status === 503) {
      setLoginAvailability(false);
      setLoginStatus(payload.error || "Login is unavailable.", true);
      return;
    }

    setLoginAvailability(true);
    setLoginStatus("Sign in to continue.");
    usernameInput.focus();
  } catch (error) {
    console.error(error);
    setLoginAvailability(true);
    setLoginStatus("Unable to reach the server.", true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginAvailability(false);
  setLoginStatus("Signing in...");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      setLoginAvailability(response.status !== 503);
      setLoginStatus(payload.error || "Unable to sign in.", true);
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }

    window.location.assign(getPostLoginTarget());
  } catch (error) {
    console.error(error);
    setLoginAvailability(true);
    setLoginStatus(error.message || "Unable to sign in.", true);
  }
});

bootstrapLogin();
