/**
 * Popup: save the pairing token and show connection status.
 * The saved token is never rendered back (SEC-004): the field stays empty and
 * the hint only says whether one exists.
 */

import { errorMessage } from "../lib/errors";

const STATUSES = new Set(["connected", "connecting", "disconnected"]);

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup: missing #${id}`);
  return node as T;
}

const dot = el<HTMLSpanElement>("dot");
const statusText = el<HTMLSpanElement>("status");
const tokenInput = el<HTMLInputElement>("token");
const savedHint = el<HTMLParagraphElement>("saved");
const saveButton = el<HTMLButtonElement>("save");

function renderStatus(status: string): void {
  const known = STATUSES.has(status) ? status : "disconnected";
  dot.dataset.status = known;
  statusText.textContent = known;
}

async function askWorker(): Promise<string> {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: "sprout-status" })) as
      | { status?: string }
      | undefined;
    return reply?.status ?? "disconnected";
  } catch {
    // The worker is asleep or starting; the alarm will reconnect shortly.
    return "connecting";
  }
}

async function renderSavedHint(): Promise<void> {
  const { token } = await chrome.storage.local.get("token");
  const hasToken = typeof token === "string" && token.trim().length > 0;

  savedHint.textContent = hasToken
    ? "A pairing token is saved (hidden)."
    : "No token saved yet.";
  savedHint.dataset.tone = "default";
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (typeof message !== "object" || message === null) return;
  const frame = message as Record<string, unknown>;

  if (frame.type === "sprout-status" && typeof frame.status === "string") {
    renderStatus(frame.status);
  }
});

saveButton.addEventListener("click", async () => {
  const token = tokenInput.value.trim();

  if (token.length === 0) {
    savedHint.textContent = "Paste a token first.";
    savedHint.dataset.tone = "error";
    tokenInput.focus();
    return;
  }

  saveButton.disabled = true;

  try {
    await chrome.storage.local.set({ token });
    tokenInput.value = "";
    await renderSavedHint();

    const reply = (await chrome.runtime.sendMessage({ type: "sprout-reconnect" })) as
      | { status?: string }
      | undefined;
    renderStatus(reply?.status ?? "connecting");
  } catch (error) {
    savedHint.textContent = `Could not save the token: ${errorMessage(error)}`;
    savedHint.dataset.tone = "error";
  } finally {
    saveButton.disabled = false;
  }
});

// Poll while the popup is open: the worker cannot push to a closed popup.
setInterval(() => {
  void askWorker().then(renderStatus);
}, 2_000);

void renderSavedHint().then(() => askWorker()).then(renderStatus);
