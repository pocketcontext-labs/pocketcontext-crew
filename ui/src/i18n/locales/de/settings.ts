// German for Settings, Home, the phone chrome and Start a session (0.36.0).
const de: Record<string, string> = {
  "How do I change what tapping an agent does?": "Wie ändere ich die Aktion beim Antippen eines Agenten?",
  "Tapping an agent can open its profile or show its tasks.": "Beim Antippen eines Agenten kannst du sein Profil oder seine Aufgaben öffnen.",
  "Choose All agents to set the default, or choose an agent to set its own action.": "Wähle „Alle Agenten“ für die Standardaktion oder einen einzelnen Agenten für dessen eigene Aktion.",
  "In Settings → Tapping an agent, choose All agents to set the default, or choose an agent by name to give it a different action.": "Wähle in den Einstellungen unter „Beim Tippen auf einen Agenten“ den Eintrag „Alle Agenten“, um die Standardaktion festzulegen. Wähle einen einzelnen Agenten, um ihm eine andere Aktion zuzuweisen.",
  "Start in a chat": "In einem Chat starten",
  "Use in another chat": "In einem anderen Chat verwenden",
  "Use {name} in a chat": "{name} in einem Chat verwenden",
  "How to continue in a chat": "So geht es im Chat weiter",
  "Copy instructions for {name}": "Anweisungen für {name} kopieren",
  "Started automatically · webhook": "Automatischer Start · Webhook",
  "Instructions copied": "Anweisungen kopiert",
  "Crew starts {name} automatically. To use it in a chat too, copy and paste its instructions.": "Crew startet {name} automatisch. Um diesen Agenten auch in einem Chat zu verwenden, kopiere seine Anweisungen und füge sie dort ein.",
  "Copy the instructions, then paste them into a chat to start {name}.": "Um {name} zu starten, kopiere die Anweisungen und füge sie in einen mit Crew verbundenen Chat ein.",
  "Before leaving your old chat, save any new decisions and the next step on the task.": "Halte neue Entscheidungen und den nächsten Schritt in der Aufgabe fest, bevor du den bisherigen Chat verlässt.",
  "Open a chat connected to Crew and paste the instructions below. You can use another subscription. If Crew is missing, connect it first.": "Öffne einen mit Crew verbundenen Chat und füge die folgenden Anweisungen ein. Du kannst ein anderes Abo verwenden. Falls Crew fehlt, verbinde es zuerst.",
  "Read the saved tasks and notes, then choose a ready task by title. Crew checks who is working on it before the new chat starts work.": "Lies die gespeicherten Aufgaben und Notizen und wähle eine bereite Aufgabe anhand ihres Titels. Crew prüft, wer daran arbeitet, bevor der neue Chat die Arbeit aufnimmt.",
  "Copy the instructions from the agent card and paste them into a chat connected to Crew. Open the card menu to see the steps again.": "Kopiere die Anweisungen von der Agentenkarte und füge sie in einen mit Crew verbundenen Chat ein. Die Schritte findest du auch im Kartenmenü.",
  // Settings
  "Couldn't save the setting. Check your connection and try again.":
    "Die Einstellung wurde nicht gespeichert. Prüfe deine Verbindung und versuche es noch einmal.",
  Language: "Sprache",
  "All agents": "Alle Agenten",
  "Agents without their own choice do this.":
    "Agenten ohne eigene Auswahl machen das.",
  "Only actions already in this agent's menu.":
    "Nur Aktionen, die schon im Menü dieses Agenten sind.",
  "The owner on this computer": "Inhaber auf diesem Computer",
  "Tapping an agent": "Beim Tippen auf einen Agenten",
  "What happens when you tap an agent on Home. A single agent can use a different action.":
    "Was passiert, wenn du auf der Startseite auf einen Agenten tippst. Einzelne Agenten können eine andere Aktion nutzen.",
  Agents: "Agenten",
  Account: "Konto",
  "Sign out": "Abmelden",
  About: "Info",
  Server: "Server",
  "Checking…": "Wird geprüft…",
  Unavailable: "Nicht verfügbar",
  Build: "Build",
  Help: "Hilfe",
  "Show all help again": "Alle Hilfen wieder anzeigen",
  "All help will show again": "Alle Hilfen werden wieder angezeigt",
  "Back to Settings": "Zurück zu den Einstellungen",
  "Open agent": "Agent öffnen",
  "Show tasks": "Aufgaben anzeigen",
  "Copy prompt for coding agent": "Prompt für Coding-Agent kopieren",
  "YOUR PREFERENCES": "DEINE EINSTELLUNGEN",
  "Language, what tapping an agent does, help, your account and the server version.":
    "Sprache, was ein Tippen auf einen Agenten macht, Hilfe, dein Konto und die Serverversion.",

  // Home
  "Loading your workspace…": "Dein Arbeitsbereich wird geladen…",
  "Create your crew": "Stelle deine Crew zusammen",
  "Agents are the AI workers on your team. Each one gets a brief and a place to keep what it learns. Start with five ready-made roles and edit them later.":
    "Agenten sind die KI-Mitarbeiter in deinem Team. Jeder bekommt ein Briefing und einen Ort für das, was er lernt. Starte mit fünf fertigen Rollen und passe sie später an.",
  "Set up starter crew": "Start-Crew einrichten",
  "Connect your first agent": "Verbinde deinen ersten Agenten",
  "Copy this MCP server address into your agent platform, then approve the connection in Crew.":
    "Kopiere diese MCP-Serveradresse in deine Agentenplattform und bestätige anschließend die Verbindung in Crew.",
  "Crew doesn't run agents itself. Your coding agent uses Crew through a skill. Run this once in your Crew folder.":
    "Crew führt selbst keine Agenten aus. Dein Coding-Agent nutzt Crew über einen Skill. Führe das einmal in deinem Crew-Ordner aus.",
  "I've connected it": "Ich habe ihn verbunden",
  "See full setup": "Vollständige Einrichtung ansehen",
  "Give your crew a first task": "Gib deiner Crew eine erste Aufgabe",
  "Describe a piece of work and assign it to an agent. It appears on the Tasks board.":
    "Beschreibe eine Arbeit und weise sie einem Agenten zu. Sie erscheint auf dem Aufgaben-Board.",
  "＋ New task": "＋ Neue Aufgabe",
  "Review the first draft": "Prüfe den ersten Entwurf",
  "When an agent finishes a draft it asks for your approval. Approving never sends or publishes anything.":
    "Wenn ein Agent einen Entwurf fertig hat, bittet er um deine Freigabe. Eine Freigabe sendet oder veröffentlicht nie etwas.",
  "Open Approvals": "Freigaben öffnen",
  "Untitled draft": "Entwurf ohne Titel",
  "New to Crew?": "Neu bei Crew?",
  "Read how it works": "Lies, wie es funktioniert",
  Dismiss: "Ausblenden",
  "Get started": "Erste Schritte",
  "{done} of {total} done": "{done} von {total} erledigt",
  "(done)": "(erledigt)",
  "Needs you": "Braucht dich",
  "Approvals waiting": "Wartende Freigaben",
  "Tasks on hold": "Angehaltene Aufgaben",
  "Draft waiting for your approval": "Entwurf wartet auf deine Freigabe",
  "Stopped after too many agent handoffs":
    "Nach zu vielen Übergaben zwischen Agenten gestoppt",
  "Assigned agent is unavailable": "Zugewiesener Agent ist nicht verfügbar",
  Recent: "Zuletzt",
  Task: "Aufgabe",
  Note: "Notiz",
  "{n} in review": "{n} wartet auf Freigabe",
  "{n} in progress": "{n} in Arbeit",
  "{n} on hold": "{n} angehalten",
  "{n} to do": "{n} zu erledigen",
  "No open tasks": "Keine offenen Aufgaben",
  "Preparing the prompt…": "Prompt wird vorbereitet…",
  "How coding sessions work": "So funktionieren Coding-Sitzungen",
  "Coding agent": "Coding-Agent",
  "More for {name}": "Mehr für {name}",
  More: "Mehr",
  "{n} approval waiting, open Approvals":
    "{n} Freigabe wartet, Freigaben öffnen",
  "{n} approvals waiting, open Approvals":
    "{n} Freigaben warten, Freigaben öffnen",
  "{n} task on hold, show on the Tasks board":
    "{n} Aufgabe angehalten, auf dem Aufgaben-Board zeigen",
  "{n} tasks on hold, show on the Tasks board":
    "{n} Aufgaben angehalten, auf dem Aufgaben-Board zeigen",

  // Phone chrome. Tab and More labels are translated where they render.
  Done: "Erledigt",
  "Crew, go to Home": "Crew, zur Startseite",
  "{label}, {count} on": "{label}, {count} aktiv",
  "Page options": "Seitenoptionen",
  Refresh: "Aktualisieren",
  "About this page": "Über diese Seite",
  "Learn more in the Guide": "Mehr dazu im Leitfaden",
  Workspace: "Arbeitsbereich",
  "{label}, {n} pending": "{label}, {n} offen",
  "One owner. One shared context.": "Ein Inhaber. Ein gemeinsamer Kontext.",
  Home: "Start",
  Tasks: "Aufgaben",
  Notes: "Notizen",
  Approvals: "Freigaben",
  Shared: "Geteilt",
  Archive: "Archiv",
  Settings: "Einstellungen",
  "Connect an agent": "Agent verbinden",
  Guide: "Anleitung",

  // Start a session
  "Agent {name}: {summary}": "Agent {name}: {summary}",
  "Agent {name}": "Agent {name}",
  Agent: "Agent",
  "Copy prompt for a coding agent as {name}":
    "Prompt für einen Coding-Agenten als {name} kopieren",
  "Preparing…": "Wird vorbereitet…",
  Copied: "Kopiert",
  "Copy coding prompt": "Coding-Prompt kopieren",
  "Copy prompt for a coding agent": "Prompt für einen Coding-Agenten kopieren",
  "How to start a session as {name}": "So startest du eine Sitzung als {name}",
  "How it works": "So funktioniert es",
  "Start a coding session as {name}": "Coding-Sitzung als {name} starten",
  Close: "Schließen",
  "Copy the prompt.": "Kopiere den Prompt.",
  "The button copies the two lines below, which tell a coding agent to act as {name} in Crew.":
    "Der Button kopiert die zwei Zeilen unten. Sie sagen einem Coding-Agenten, dass er in Crew als {name} arbeitet.",
  "Open your coding agent.": "Öffne deinen Coding-Agenten.",
  "Start a new session in Codex, Claude Code or another coding agent, in the repository you want to work on.":
    "Starte eine neue Sitzung in Codex, Claude Code oder einem anderen Coding-Agenten, im Repository, an dem du arbeiten willst.",
  "Paste and send.": "Einfügen und senden.",
  "The agent connects to Crew, picks up {name}'s Ready tasks, and works by the instructions you keep in Crew.":
    "Der Agent verbindet sich mit Crew, übernimmt die bereiten Aufgaben von {name} und arbeitet nach den Anweisungen, die du in Crew pflegst.",
  "Session prompt for {name}": "Sitzungs-Prompt für {name}",
  "Loading the prompt…": "Prompt wird geladen…",
  "Copy session prompt for {name}": "Sitzungs-Prompt für {name} kopieren",
  Copy: "Kopieren",
  "Don't show this again": "Nicht mehr anzeigen",
  "Got it": "Verstanden",
  "Copied the session prompt for {name}. Paste it into a new session in your coding agent.":
    "Sitzungs-Prompt für {name} kopiert. Füge ihn in eine neue Sitzung deines Coding-Agenten ein.",
  "Could not copy automatically. Copy the session prompt for {name} into a new agent session:":
    "Automatisches Kopieren ging nicht. Kopiere den Sitzungs-Prompt für {name} in eine neue Agenten-Sitzung:",
  "Could not prepare the session prompt for {name}. Check your connection and try again.":
    "Der Sitzungs-Prompt für {name} konnte nicht vorbereitet werden. Prüfe deine Verbindung und versuche es noch einmal.",
  View: "Ansehen",
  "sheet|Done": "Fertig",
};

export default de;
