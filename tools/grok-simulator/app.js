const status = document.querySelector("#status");
const chats = new Map();
const mode = document.querySelector("#mode");
let switching = false;
mode.addEventListener("change", async () => {
  switching = true;
  mode.disabled = true;
  try {
    const response = await fetch("/api/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not change mode.");
    status.textContent = "Mode changed.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    switching = false;
    await refresh().catch((error) => {
      status.textContent = error.message;
    });
  }
});
const labels = {
  owner: "You",
  agent: "Agent",
  webhook: "Webhook",
  message: "Bot message",
  error: "Error",
};
async function refresh() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Could not load the simulator.");
  const state = await response.json();
  if (!switching) {
    mode.value = state.mode;
    mode.disabled = state.busy;
  }
  for (const key of ["url", "secret"])
    document.getElementById(key).value = state.credentials[key];
  for (const [role, name] of Object.entries(state.participants)) {
    let chat = chats.get(role);
    if (!chat) {
      chat = document
        .querySelector("#chat")
        .content.firstElementChild.cloneNode(true);
      chats.set(role, chat);
      chat.querySelector(".heading p").textContent = role;
      chat.querySelector("h2").textContent = name;
      chat.setAttribute("aria-label", name);
      const editor = chat.querySelector("textarea");
      editor.setAttribute("aria-label", "Message " + name);
      chat.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = editor.value.trim();
        if (!text) return;
        const button = chat.querySelector("button");
        button.disabled = true;
        try {
          const sent = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, text }),
          });
          if (!sent.ok) throw new Error("Message could not be queued.");
          if (editor.value.trim() === text) editor.value = "";
          await refresh();
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      document.querySelector("#chats").append(chat);
    }
    const entries = state.chats[role];
    const list = chat.querySelector("ol");
    const signature = JSON.stringify(entries);
    if (list.dataset.signature === signature) continue;
    list.dataset.signature = signature;
    const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    list.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent =
          (labels[entry.source] || entry.source) +
          " · " +
          new Date(entry.time).toLocaleTimeString();
        const text = document.createElement("div");
        text.textContent = entry.text;
        row.dataset.source = entry.source;
        row.append(title, text);
        return row;
      }),
    );
    if (nearEnd) list.scrollTop = list.scrollHeight;
  }
}
for (const button of document.querySelectorAll("[data-copy]"))
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        document.getElementById(button.dataset.copy).value,
      );
      status.textContent = "Copied.";
    } catch {
      status.textContent =
        "Clipboard unavailable. Select the field and copy it manually.";
    }
  });
async function poll() {
  try {
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
  setTimeout(poll, 1200);
}
poll();
