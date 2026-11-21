// German reader strings for files, previews, the upload page, Connect,
// wake-up setup, Help and the Guide. Keys are the English text (i18n/index.ts).
// Some keys come from tables translated where they render (wake rules,
// delivery states, history labels, link states, help topics); they are listed
// here too.
const de: Record<string, string> = {
  "First setup: start each Grok bot in a chat": "Ersteinrichtung: Jeden Grok-Bot im Chat starten",
  "Open Agents and choose “Copy startup prompt” on the matching Crew agent. Paste the prompt into that bot’s own Grok chat so it reads its Crew name, brief and saved instructions.": "Öffne Agenten und wähle beim passenden Crew-Agenten „Startprompt kopieren“. Füge den Prompt in den Grok-Chat des Bots ein, damit er seinen Crew-Namen, sein Briefing und seine gespeicherten Anweisungen liest.",
  "Open Agents": "Agenten öffnen",
  "Do this once per bot, including the dispatcher. Then return here to configure routing and authorize the bots. Each new task wake loads the latest saved instructions.": "Führe das einmal für jeden Bot aus, auch für den Dispatcher. Kehre dann hierher zurück, um das Routing einzurichten und die Bots zu autorisieren. Bei jedem neuen Aufgabenstart werden die aktuellen gespeicherten Anweisungen geladen.",
  "Create an agent and name it after the project. You can start it in a connected chat.": "Erstelle einen Agenten und benenne ihn nach dem Projekt. Du kannst ihn in einem verbundenen Chat starten.",
  "Start an agent in a connected chat by copying its instructions. To wake it automatically for ready tasks, connect an integration and enable automatic startup for that agent.": "Kopiere die Anweisungen in einen verbundenen Chat, um einen Agenten zu starten. Für den automatischen Start bei bereiten Aufgaben verbindest du eine Integration und aktivierst den automatischen Start für diesen Agenten.",
  "Open the agent to see its instructions and startup settings.": "Öffne den Agenten, um seine Anweisungen und Starteinstellungen zu sehen.",
  // Wake-up setup (WebhookStatus)
  "Unknown delivery status": "Zustellstatus unbekannt",
  Complete: "Erledigt",
  "Hide prompt": "Prompt ausblenden",
  "Read prompt": "Prompt lesen",
  "Could not load the integration. Crew will try again shortly.":
    "Die Integration konnte nicht geladen werden. Crew versucht es gleich noch einmal.",
  "The saved routine's managed block does not match Crew. Apply the current block from step 2, then report synchronization again.":
    "Der verwaltete Block der gespeicherten Routine stimmt nicht mit Crew überein. Wende den aktuellen Block aus Schritt 2 an und melde die Synchronisierung erneut.",
  "Send the safe connection test and wait for the actual webhook routine to report its capabilities.":
    "Sende den sicheren Verbindungstest und warte, bis die echte Webhook-Routine ihre Fähigkeiten meldet.",
  "The routine has not reported native messaging. If it uses WakeParent, select the parent bridge and apply its current instructions.":
    "Die Routine hat kein natives Messaging gemeldet. Wenn sie WakeParent nutzt, wähle die Parent-Brücke und wende ihre aktuellen Anweisungen an.",
  "The routine has not reported WakeParent. Check its actual tools and run the connection test again.":
    "Die Routine hat WakeParent nicht gemeldet. Prüfe ihre tatsächlichen Tools und führe den Verbindungstest erneut aus.",
  "The dispatcher parent has not acknowledged the wake. Check its Grok conversation before sending another test.":
    "Der Dispatcher-Parent hat das Wecken nicht bestätigt. Prüfe seine Grok-Unterhaltung, bevor du einen weiteren Test sendest.",
  "The dispatcher parent has not reported native bot messaging. Check its available tools.":
    "Der Dispatcher-Parent hat kein natives Bot-Messaging gemeldet. Prüfe seine verfügbaren Tools.",
  "The dispatcher parent cannot use Crew's execution protocol. Refresh its tools before testing again.":
    "Der Dispatcher-Parent kann das Ausführungsprotokoll von Crew nicht nutzen. Aktualisiere seine Tools, bevor du erneut testest.",
  "Choose a mapped teammate and run the end-to-end test before enabling delivery.":
    "Wähle ein zugeordnetes Teammitglied und führe den End-to-End-Test aus, bevor du die Zustellung aktivierst.",
  "The recipient has not acknowledged the test. Check its Grok conversation and prior authorization; do not resend an uncertain message.":
    "Der Empfänger hat den Test nicht bestätigt. Prüfe seine Grok-Unterhaltung und die vorherige Autorisierung; sende eine unsichere Nachricht nicht erneut.",
  "Another execution is live on this task. The recipient must use execution.begin and the fenced task protocol, or wait for the live run to end.":
    "Für diese Aufgabe läuft bereits eine andere Ausführung. Der Empfänger muss execution.begin und das abgesicherte Aufgabenprotokoll verwenden oder warten, bis der laufende Durchlauf endet.",
  "Send the safe connection test and wait for its acknowledgment.":
    "Sende den sicheren Verbindungstest und warte auf seine Bestätigung.",
  "This configuration changed elsewhere. Review the latest settings and try again.":
    "Diese Konfiguration wurde anderswo geändert. Prüfe die neuesten Einstellungen und versuche es erneut.",
  "The change could not be confirmed. Check the configuration and try again. Credentials are never included in this message.":
    "Die Änderung konnte nicht bestätigt werden. Prüfe die Konfiguration und versuche es erneut. Zugangsdaten sind in dieser Meldung nie enthalten.",
  "Instructions not applied": "Anweisungen nicht angewendet",
  "Matching saved text reported":
    "Übereinstimmender gespeicherter Text gemeldet",
  "Application reported": "Anwendung gemeldet",
  "Choose an active dispatcher in step 1.":
    "Wähle in Schritt 1 einen aktiven Dispatcher.",
  "Ask Grok to confirm the dispatcher's bot mapping using the setup prompt.":
    "Bitte Grok mit dem Einrichtungs-Prompt, die Bot-Zuordnung des Dispatchers zu bestätigen.",
  "Paste the webhook URL and secret in step 3.":
    "Füge in Schritt 3 die Webhook-URL und das Secret ein.",
  "Apply instruction revision {n} in Grok using the setup prompt.":
    "Wende Anweisungsrevision {n} in Grok mit dem Einrichtungs-Prompt an.",
  "Complete the connection test and refresh its acknowledgment before enabling.":
    "Schließe den Verbindungstest ab und aktualisiere seine Bestätigung, bevor du aktivierst.",
  "Could not copy. Open the prompt and copy its text manually.":
    "Kopieren fehlgeschlagen. Öffne den Prompt und kopiere den Text von Hand.",
  "Credentials saved. No request was sent.":
    "Zugangsdaten gespeichert. Es wurde keine Anfrage gesendet.",
  "Saving changed wake rules turns delivery off, cancels queued wakes and interrupts bots working on Ready tasks. Turn delivery back on afterwards. Ready tasks are not woken again until you put them on hold, then set them Ready.":
    "Geänderte Weckregeln zu speichern schaltet die Zustellung aus, bricht wartende Weckrufe ab und unterbricht Bots, die an bereiten Aufgaben arbeiten. Schalte die Zustellung danach wieder ein. Bereite Aufgaben werden erst wieder geweckt, wenn du sie anhältst und dann wieder auf Bereit setzt.",
  "Saving changed wake rules cancels queued wakes and interrupts bots working on Ready tasks. Ready tasks are not woken again until you put them on hold, then set them Ready.":
    "Geänderte Weckregeln zu speichern bricht wartende Weckrufe ab und unterbricht Bots, die an bereiten Aufgaben arbeiten. Bereite Aufgaben werden erst wieder geweckt, wenn du sie anhältst und dann wieder auf Bereit setzt.",
  "Save the new wake rules?": "Neue Weckregeln speichern?",
  "Wake rules saved. Delivery is off; turn it back on with Enable delivery.":
    "Weckregeln gespeichert. Die Zustellung ist aus; schalte sie mit Zustellung aktivieren wieder ein.",
  "Wake rules saved.": "Weckregeln gespeichert.",
  "Bot handoff limit saved.": "Übergabelimit für Bots gespeichert.",
  "The handoff limit was saved, but the rule changes were not. {reason}":
    "Das Übergabelimit wurde gespeichert, die Regeländerungen aber nicht. {reason}",
  "Set up automatic wake-ups": "Automatisches Wecken einrichten",
  "Grok Bot integration": "Grok-Bot-Integration",
  "Grok setup": "Grok-Einrichtung",
  "One existing bot receives Crew notifications and routes them to your team. Keep your normal bot roles and one shared MCP connection.":
    "Ein vorhandener Bot empfängt Crew-Benachrichtigungen und leitet sie an dein Team weiter. Behalte deine normalen Bot-Rollen und eine gemeinsame MCP-Verbindung.",
  "One existing bot receives Crew notifications and routes them to your team. Keep your normal bot roles.":
    "Ein vorhandener Bot empfängt Crew-Benachrichtigungen und leitet sie an dein Team weiter. Behalte deine normalen Bot-Rollen.",
  "Loading integration…": "Integration wird geladen…",
  "No global integration is available yet. It appears here after the server upgrade completes.":
    "Noch keine globale Integration verfügbar. Sie erscheint hier, sobald das Server-Upgrade abgeschlossen ist.",
  "Automatic wake-ups: on": "Automatisches Wecken: an",
  "{mapped} of {total} agents mapped":
    "{mapped} von {total} Agenten zugeordnet",
  "Hide setup": "Einrichtung ausblenden",
  "Review setup": "Einrichtung prüfen",
  "Delivery enabled": "Zustellung aktiviert",
  "Delivery disabled": "Zustellung deaktiviert",
  "Dispatcher: {name}": "Dispatcher: {name}",
  "Not selected or inactive": "Nicht gewählt oder inaktiv",
  "Only Ready tasks can wake a bot. Enabling does not notify existing tasks.":
    "Nur bereite Aufgaben können einen Bot wecken. Das Aktivieren benachrichtigt keine bestehenden Aufgaben.",
  "Choose your dispatcher": "Dispatcher wählen",
  "Use an existing bot. It keeps its main job and also routes Crew notifications.":
    "Nutze einen vorhandenen Bot. Er behält seine Hauptaufgabe und leitet zusätzlich Crew-Benachrichtigungen weiter.",
  "Choosing a manually started agent as your first dispatcher makes it a webhook bot. You can still start it in a chat. Delivery stays off until you enable it.":
    "Wenn du einen manuell gestarteten Agenten als ersten Dispatcher auswählst, wird er zum Webhook-Bot. Du kannst ihn weiterhin in einem Chat starten. Die Zustellung bleibt ausgeschaltet, bis du sie aktivierst.",
  "Crew dispatcher": "Crew-Dispatcher",
  "Dispatcher changed. Connect its routine before enabling delivery.":
    "Dispatcher geändert. Verbinde seine Routine, bevor du die Zustellung aktivierst.",
  "Choose an agent": "Agent wählen",
  "Changing the dispatcher pauses delivery and clears the previous webhook binding.":
    "Ein Wechsel des Dispatchers pausiert die Zustellung und löscht die bisherige Webhook-Bindung.",
  "Dispatch path": "Weiterleitungsweg",
  "Dispatch path changed. Apply the current instructions and test again. Credentials were preserved.":
    "Weiterleitungsweg geändert. Wende die aktuellen Anweisungen an und teste erneut. Die Zugangsdaten bleiben erhalten.",
  "Via the bot's parent conversation": "Über die Parent-Unterhaltung des Bots",
  "Directly inside the webhook routine": "Direkt in der Webhook-Routine",
  "The routine wakes its parent conversation, which can work or message a teammate.":
    "Die Routine weckt ihre Parent-Unterhaltung, die selbst arbeiten oder einem Teammitglied schreiben kann.",
  "Use direct dispatch only when native bot messaging is available inside the routine. For Grok routines with WakeParent, choose the parent conversation.":
    "Nutze die direkte Weiterleitung nur, wenn natives Bot-Messaging in der Routine verfügbar ist. Wähle für Grok-Routinen mit WakeParent die Parent-Unterhaltung.",
  "Prepare Grok": "Grok vorbereiten",
  "Two prompts, in this order. Both are required.":
    "Zwei Prompts, in dieser Reihenfolge. Beide sind nötig.",
  "First: paste once into {name}'s Grok chat":
    "Zuerst: einmal in den Grok-Chat von {name} einfügen",
  "your selected bot": "deinem gewählten Bot",
  "It asks Grok to discover your bots, save mappings and apply the current routine instructions where its tools support them.":
    "Er bittet Grok, deine Bots zu finden, Zuordnungen zu speichern und die aktuellen Routine-Anweisungen anzuwenden, soweit seine Tools das unterstützen.",
  "Read setup prompt": "Einrichtungs-Prompt lesen",
  "Setup prompt copied. It contains no credentials.":
    "Einrichtungs-Prompt kopiert. Er enthält keine Zugangsdaten.",
  "Copy setup prompt": "Einrichtungs-Prompt kopieren",
  "Revision {n}": "Revision {n}",
  "Apply instruction revision {n} in Grok. This page updates automatically.":
    "Wende Anweisungsrevision {n} in Grok an. Diese Seite aktualisiert sich automatisch.",
  "{mapped} of {total} agents mapped.":
    "{mapped} von {total} Agenten zugeordnet.",
  "Not mapped": "Nicht zugeordnet",
  "Then: paste once into a Grok group with all your bots":
    "Dann: einmal in eine Grok-Gruppe mit allen deinen Bots einfügen",
  "Create a group chat with you and {who}, then paste this there. Do it after the first prompt and before testing. Each bot needs your authorization directly: the first bot can't give it on your behalf.":
    "Erstelle einen Gruppenchat mit dir und {who} und füge dies dort ein. Mach das nach dem ersten Prompt und vor dem Testen. Jeder Bot braucht deine Autorisierung direkt von dir: Der erste Bot kann sie nicht in deinem Namen erteilen.",
  "all {n} bots": "allen {n} Bots",
  "your bot": "deinem Bot",
  "Read group authorization prompt": "Gruppen-Autorisierungs-Prompt lesen",
  "Group authorization prompt copied. Paste it once in the group with all your bots.":
    "Gruppen-Autorisierungs-Prompt kopiert. Füge ihn einmal in die Gruppe mit allen deinen Bots ein.",
  "Copy group authorization prompt": "Gruppen-Autorisierungs-Prompt kopieren",
  "Can't use a group? Paste into each bot's own chat":
    "Keine Gruppe möglich? In den eigenen Chat jedes Bots einfügen",
  "Read bot authorization prompt": "Bot-Autorisierungs-Prompt lesen",
  "Authorization prompt copied. Paste it into each bot's own conversation.":
    "Autorisierungs-Prompt kopiert. Füge ihn in die eigene Unterhaltung jedes Bots ein.",
  "Copy bot authorization prompt": "Bot-Autorisierungs-Prompt kopieren",
  "Unmapped agents cannot receive Ready-task notifications. The setup prompt asks only about ambiguous matches.":
    "Nicht zugeordnete Agenten erhalten keine Benachrichtigungen zu bereiten Aufgaben. Der Einrichtungs-Prompt fragt nur bei mehrdeutigen Treffern nach.",
  "Enter webhook credentials": "Webhook-Zugangsdaten eingeben",
  "Copy the URL and key from the selected bot's Grok routine directly into Crew. Never paste them into chat.":
    "Kopiere URL und Schlüssel aus der Grok-Routine des gewählten Bots direkt in Crew. Füge sie nie in einen Chat ein.",
  "Endpoint: {endpoint}": "Endpunkt: {endpoint}",
  configured: "eingerichtet",
  "not configured": "nicht eingerichtet",
  "Credential: {credential}": "Zugangsdaten: {credential}",
  "Replace saved credentials": "Gespeicherte Zugangsdaten ersetzen",
  "Add credentials": "Zugangsdaten hinzufügen",
  "Replacement webhook URL": "Neue Webhook-URL",
  "Webhook URL": "Webhook-URL",
  "Replacement secret": "Neues Secret",
  "Webhook secret": "Webhook-Secret",
  "Saved values are never filled back in. Leave a field empty to keep it. Replacing the URL requires a new secret. Saving sends nothing.":
    "Gespeicherte Werte werden nie wieder eingefüllt. Lass ein Feld leer, um es zu behalten. Eine neue URL braucht ein neues Secret. Speichern sendet nichts.",
  "Save credentials": "Zugangsdaten speichern",
  "Verify the connection": "Verbindung prüfen",
  "Test the complete route: routine, parent conversation, and selected recipient. This explicitly sends a diagnostic message to a teammate when selected, but performs no task work.":
    "Teste den ganzen Weg: Routine, Parent-Unterhaltung und gewählten Empfänger. Das sendet ausdrücklich eine Diagnosenachricht an ein gewähltes Teammitglied, erledigt aber keine Aufgabenarbeit.",
  "Send a connection test to the routine. It acknowledges the test without task work or forwarding.":
    "Sende einen Verbindungstest an die Routine. Sie bestätigt den Test ohne Aufgabenarbeit oder Weiterleitung.",
  "Test recipient": "Testempfänger",
  "Map a bot first": "Ordne zuerst einen Bot zu",
  "(dispatcher)": "(Dispatcher)",
  "Test queued. Acknowledgment progress updates here automatically. Do not send another test while the outcome is uncertain.":
    "Test eingereiht. Der Bestätigungsstand aktualisiert sich hier automatisch. Sende keinen weiteren Test, solange das Ergebnis unsicher ist.",
  "Send test": "Test senden",
  "Connection test progress": "Fortschritt des Verbindungstests",
  "Webhook:": "Webhook:",
  "no current delivery recorded": "keine aktuelle Zustellung erfasst",
  "Routine:": "Routine:",
  "test acknowledged": "Test bestätigt",
  "awaiting acknowledgment": "Bestätigung ausstehend",
  "Routine capabilities:": "Fähigkeiten der Routine:",
  reported: "gemeldet",
  "awaiting report": "Meldung ausstehend",
  "Parent wake capability:": "Parent-Weckfähigkeit:",
  "Parent conversation:": "Parent-Unterhaltung:",
  "receipt recorded": "Empfang erfasst",
  "awaiting receipt": "Empfang ausstehend",
  "Native send:": "Natives Senden:",
  "not reported": "nicht gemeldet",
  "Recipient:": "Empfänger:",
  "not needed for this dispatcher-only test":
    "für diesen reinen Dispatcher-Test nicht nötig",
  "acknowledgment recorded": "Bestätigung erfasst",
  "Test acknowledgment overdue. Check the bot conversations and authorization before starting a new test. No automatic resend.":
    "Testbestätigung überfällig. Prüfe die Bot-Unterhaltungen und die Autorisierung, bevor du einen neuen Test startest. Kein automatisches erneutes Senden.",
  "Latest test recipient:": "Letzter Testempfänger:",
  "Unavailable agent": "Nicht verfügbarer Agent",
  "Receiver acceptance, parent receipt and recipient acknowledgment are separate stages. Reports are supplied by bots using the shared connection; they do not independently identify a bot or guarantee reliable delivery. Check Grok before retrying an uncertain outcome.":
    "Annahme durch den Empfänger, Empfang beim Parent und Bestätigung durch den Empfänger sind getrennte Stufen. Meldungen kommen von Bots über die gemeinsame Verbindung; sie identifizieren keinen Bot unabhängig und garantieren keine zuverlässige Zustellung. Prüfe Grok, bevor du ein unsicheres Ergebnis wiederholst.",
  "Enable future notifications": "Künftige Benachrichtigungen aktivieren",
  "Enable delivery after checking the routine's setup. Existing tasks are not replayed.":
    "Aktiviere die Zustellung, nachdem du die Einrichtung der Routine geprüft hast. Bestehende Aufgaben werden nicht erneut gesendet.",
  "Delivery enabled. Existing tasks were not replayed.":
    "Zustellung aktiviert. Bestehende Aufgaben wurden nicht erneut gesendet.",
  "Delivery disabled.": "Zustellung deaktiviert.",
  "Disable delivery": "Zustellung deaktivieren",
  "Enable delivery": "Zustellung aktivieren",
  "Verify task routing (optional)": "Aufgaben-Weiterleitung prüfen (optional)",
  "Use an explicit synthetic test to check work for the dispatcher itself and a handoff to another bot. This is separate from the harmless connection test.":
    "Prüfe mit einem ausdrücklichen synthetischen Test die Arbeit für den Dispatcher selbst und eine Übergabe an einen anderen Bot. Das ist getrennt vom harmlosen Verbindungstest.",
  "Dispatcher task:": "Dispatcher-Aufgabe:",
  "completed execution recorded": "abgeschlossene Ausführung erfasst",
  "not yet verified": "noch nicht geprüft",
  "Specialist task:": "Spezialisten-Aufgabe:",
  "Read routing test prompt": "Prompt für den Weiterleitungstest lesen",
  "Routing test prompt copied. It authorizes only the described synthetic tasks.":
    "Prompt für den Weiterleitungstest kopiert. Er autorisiert nur die beschriebenen synthetischen Aufgaben.",
  "Copy routing test prompt": "Prompt für den Weiterleitungstest kopieren",
  "Enable delivery first, then run only the authorized sample tasks. Recorded completion is reported by the worker; check the resulting task and Grok conversation.":
    "Aktiviere zuerst die Zustellung und führe dann nur die autorisierten Beispielaufgaben aus. Der erfasste Abschluss wird vom Bearbeiter gemeldet; prüfe die entstandene Aufgabe und die Grok-Unterhaltung.",
  "Wake rules": "Weckregeln",
  "Reset to recommended": "Auf Empfehlung zurücksetzen",
  "Which changes wake a bot. A task must be Ready, not done and not waiting for approval before any rule can wake it.":
    "Welche Änderungen einen Bot wecken. Eine Aufgabe muss bereit, nicht erledigt und nicht auf Freigabe wartend sein, bevor eine Regel sie wecken kann.",
  "Wake a bot when": "Einen Bot wecken, wenn",
  "Recommended: on": "Empfohlen: an",
  "Recommended: off": "Empfohlen: aus",
  "Triage agent: {name}.": "Triage-Agent: {name}.",
  "No triage agent is chosen, so this wakes no one; your assistant can choose one. Turn it on only after that.":
    "Kein Triage-Agent gewählt, daher weckt das niemanden; dein Assistent kann einen wählen. Schalte es erst danach ein.",
  "Bot handoff limit": "Übergabelimit für Bots",
  "Recommended: {n}": "Empfohlen: {n}",
  "How many times in a row bots can pass a task to each other (1 to 20). When reached, the task goes on hold until you act. Any edit or comment from you resets the count; an agent setting it Ready does not.":
    "Wie oft hintereinander Bots eine Aufgabe weitergeben können (1 bis 20). Ist das Limit erreicht, wird die Aufgabe angehalten, bis du handelst. Jede Änderung oder jeder Kommentar von dir setzt den Zähler zurück; ein Agent, der sie auf Bereit setzt, nicht.",
  "Save wake rules": "Weckregeln speichern",
  "Choose at least one rule.": "Wähle mindestens eine Regel.",
  "Enter a whole number from 1 to 20.": "Gib eine ganze Zahl von 1 bis 20 ein.",
  "Wakes not received": "Nicht empfangene Weckrufe",
  "Crew woke these bots but they never confirmed receiving the wake. Check each bot's conversation; Crew does not resend on its own.":
    "Crew hat diese Bots geweckt, aber sie haben den Empfang nie bestätigt. Prüfe die Unterhaltung jedes Bots; Crew sendet nicht von selbst erneut.",
  "Untitled task": "Unbenannte Aufgabe",
  "The dispatcher": "Der Dispatcher",
  "Overdue, due ": "Überfällig, fällig ",
  "Overdue since an unknown time": "Überfällig seit unbekannter Zeit",
  "Notification activity": "Benachrichtigungsverlauf",
  "Receiver acceptance does not mean the task started or completed. Human review decisions remain separate.":
    "Die Annahme durch den Empfänger heißt nicht, dass die Aufgabe begonnen oder abgeschlossen wurde. Freigabeentscheidungen von Menschen bleiben getrennt.",
  "No deliveries recorded.": "Keine Zustellungen erfasst.",
  "Show all ({n})": "Alle anzeigen ({n})",
  "Show fewer": "Weniger anzeigen",
  "Showing the 30 most recent deliveries.":
    "Die 30 neuesten Zustellungen werden angezeigt.",
  "Advanced settings and recovery":
    "Erweiterte Einstellungen und Wiederherstellung",
  "{n} previous per-agent configurations are retained as disabled history.":
    "{n} frühere Konfigurationen pro Agent bleiben als deaktivierter Verlauf erhalten.",
  "Bot mappings": "Bot-Zuordnungen",
  "Normally your assistant manages these from the setup prompt. Edit a reference only when you can resolve it unambiguously in Grok.":
    "Normalerweise verwaltet dein Assistent diese über den Einrichtungs-Prompt. Bearbeite eine Referenz nur, wenn du sie in Grok eindeutig zuordnen kannst.",
  "Bot mapping saved.": "Bot-Zuordnung gespeichert.",
  "Managed instructions": "Verwaltete Anweisungen",
  "{status}. Matching saved text is reported by the assistant; Crew does not independently inspect Grok.":
    "{status}. Übereinstimmender gespeicherter Text wird vom Assistenten gemeldet; Crew prüft Grok nicht selbst.",
  "Routine reference: {ref}": "Routine-Referenz: {ref}",
  "Routine instructions": "Routine-Anweisungen",
  "Managed instructions copied. No credentials are included.":
    "Verwaltete Anweisungen kopiert. Zugangsdaten sind nicht enthalten.",
  "Copy instructions": "Anweisungen kopieren",
  "Role and reporting instructions": "Rollen- und Berichtsanweisungen",
  "Instructions saved. Delivery is off until the routine is applied, tested and enabled again.":
    "Anweisungen gespeichert. Die Zustellung ist aus, bis die Routine angewendet, getestet und wieder aktiviert ist.",
  "Bot role instructions": "Anweisungen zur Bot-Rolle",
  "Reporting instructions": "Berichtsanweisungen",
  "These settings stay outside Crew's managed block. After changing them, apply and report the saved routine again.":
    "Diese Einstellungen liegen außerhalb des verwalteten Blocks von Crew. Wende die gespeicherte Routine nach einer Änderung erneut an und melde sie.",
  "Save instructions": "Anweisungen speichern",
  "Retry authorized. Ask the intended recipient to resume this execution; no webhook or message was sent.":
    "Neuer Versuch autorisiert. Bitte den vorgesehenen Empfänger, diese Ausführung fortzusetzen; es wurde kein Webhook und keine Nachricht gesendet.",
  "Coordinated work cancelled. External actions were not undone.":
    "Koordinierte Arbeit abgebrochen. Externe Aktionen wurden nicht rückgängig gemacht.",
  "{name} bot ({ref})": "{name}-Bot ({ref})",
  "{name} routing": "Weiterleitung für {name}",
  "Grok Bot reference for {name}": "Grok-Bot-Referenz für {name}",
  "Confirmed bot reference": "Bestätigte Bot-Referenz",
  "Bot display name for {name} (optional)":
    "Anzeigename des Bots für {name} (optional)",
  "Name shown in Grok": "Name in Grok",
  "Save {name} mapping": "Zuordnung für {name} speichern",
  "Dispatcher started": "Dispatcher gestartet",
  "Handoff prepared": "Übergabe vorbereitet",
  "Handoff reported": "Übergabe gemeldet",
  "Recipient started": "Empfänger hat begonnen",
  "Execution recorded": "Ausführung erfasst",
  "Later activity replaced this attempt; nothing to do here.":
    "Spätere Aktivität hat diesen Versuch ersetzt; hier ist nichts zu tun.",
  "This is more than a day old. Review the bot conversation only if the outcome still matters.":
    "Das ist mehr als einen Tag alt. Prüfe die Bot-Unterhaltung nur, wenn das Ergebnis noch wichtig ist.",
  "Task wake for {name}": "Aufgaben-Weckruf für {name}",
  "Task wake": "Aufgaben-Weckruf",
  "Connection test": "Verbindungstest",
  "Recipient acknowledgment overdue": "Bestätigung des Empfängers überfällig",
  "Waiting for recipient acquisition":
    "Warten auf Übernahme durch den Empfänger",
  "{time} elapsed": "{time} vergangen",
  "Review the bot conversation before recovery. No automatic resend.":
    "Prüfe die Bot-Unterhaltung vor der Wiederherstellung. Kein automatisches erneutes Senden.",
  "A reported send is not proof that the recipient started.":
    "Ein gemeldetes Senden beweist nicht, dass der Empfänger begonnen hat.",
  "Execution lease expired ": "Ausführungs-Lease abgelaufen ",
  "Execution lease expires ": "Ausführungs-Lease läuft ab ",
  "Reconcile the outcome before authorizing another attempt.":
    "Kläre das Ergebnis, bevor du einen weiteren Versuch autorisierst.",
  "Recover interrupted work ({n})":
    "Unterbrochene Arbeit wiederherstellen ({n})",
  "The bot may already have performed external work. Review the bot conversation and affected systems before deciding. Cancelling cannot undo external actions.":
    "Der Bot hat möglicherweise schon externe Arbeit erledigt. Prüfe die Bot-Unterhaltung und betroffene Systeme, bevor du entscheidest. Abbrechen macht externe Aktionen nicht rückgängig.",
  "Execution to recover": "Wiederherzustellende Ausführung",
  "Choose an execution": "Ausführung wählen",
  Task: "Aufgabe",
  Unknown: "Unbekannt",
  "I reviewed the uncertain outcome and any external actions.":
    "Ich habe das unsichere Ergebnis und alle externen Aktionen geprüft.",
  "Cancel coordinated work": "Koordinierte Arbeit abbrechen",
  "Authorize another attempt": "Weiteren Versuch autorisieren",
  "Retry authorizes another acquisition of this execution. It does not send a webhook or message. Ask the intended bot to resume it after authorization. Cancelling coordination cannot stop a run already in progress or undo external actions.":
    "Ein neuer Versuch autorisiert eine weitere Übernahme dieser Ausführung. Er sendet keinen Webhook und keine Nachricht. Bitte den vorgesehenen Bot nach der Autorisierung, sie fortzusetzen. Das Abbrechen der Koordination stoppt keinen laufenden Durchlauf und macht externe Aktionen nicht rückgängig.",
  "{n} attempt": "{n} Versuch",
  "{n} attempts": "{n} Versuche",
  "Created ready": "Bereit erstellt",
  Assigned: "Zugewiesen",
  Reassigned: "Neu zugewiesen",
  "Marked ready": "Auf Bereit gesetzt",
  Reopened: "Wieder geöffnet",
  "Review resolved": "Freigabe entschieden",
  "Unassigned (triage)": "Nicht zugewiesen (Triage)",
  "Explicit catch-up": "Ausdrückliches Nachholen",
  "Owner comment": "Kommentar von dir",
  "Wakes the assigned bot when a task is created already Ready. Off: such tasks wait until something else wakes them.":
    "Weckt den zugewiesenen Bot, wenn eine Aufgabe schon bereit erstellt wird. Aus: Solche Aufgaben warten, bis etwas anderes sie weckt.",
  "Wakes the bot a Ready task is assigned to. Off: assigning alone wakes no one.":
    "Weckt den Bot, dem eine bereite Aufgabe zugewiesen wird. Aus: Zuweisen allein weckt niemanden.",
  "Wakes the new bot when a Ready task moves from one bot to another. Off: handoffs between bots stall.":
    "Weckt den neuen Bot, wenn eine bereite Aufgabe von einem Bot zu einem anderen wechselt. Aus: Übergaben zwischen Bots bleiben stecken.",
  "Wakes the assigned bot when a task on hold is set Ready, the normal way to release work. Off: setting Ready wakes no one.":
    "Weckt den zugewiesenen Bot, wenn eine angehaltene Aufgabe auf Bereit gesetzt wird, der normale Weg, Arbeit freizugeben. Aus: Auf Bereit setzen weckt niemanden.",
  "Wakes the assigned bot when a Ready task is reopened from Done or restored from the archive. Off: it waits until something else wakes it.":
    "Weckt den zugewiesenen Bot, wenn eine bereite Aufgabe aus Erledigt wieder geöffnet oder aus dem Archiv wiederhergestellt wird. Aus: Sie wartet, bis etwas anderes sie weckt.",
  "Wakes the assigned bot when a review is decided or withdrawn, so it can continue. Off: it waits until something else wakes it.":
    "Weckt den zugewiesenen Bot, wenn eine Freigabe entschieden oder zurückgezogen wird, damit er weitermachen kann. Aus: Sie wartet, bis etwas anderes sie weckt.",
  "Wakes the triage agent when a Ready task loses its assignee. Off: such tasks wait for you.":
    "Weckt den Triage-Agenten, wenn eine bereite Aufgabe ihren zugewiesenen Agenten verliert. Aus: Solche Aufgaben warten auf dich.",
  "Lets you or your assistant ask for a catch-up wake on chosen Ready tasks. Never fires on its own. Off: catch-up requests are refused.":
    "Lässt dich oder deinen Assistenten für gewählte bereite Aufgaben einen Nachhol-Weckruf anfordern. Löst nie von selbst aus. Aus: Nachhol-Anfragen werden abgelehnt.",
  "Wakes the assigned bot when you comment on a Ready task in the browser; agent comments never wake. Turn on if you steer bots through comments. Off: comments are only recorded.":
    "Weckt den zugewiesenen Bot, wenn du im Browser eine bereite Aufgabe kommentierst; Kommentare von Agenten wecken nie. Schalte es ein, wenn du Bots über Kommentare steuerst. Aus: Kommentare werden nur gespeichert.",
  Queued: "In Warteschlange",
  Sending: "Wird gesendet",
  "Accepted by receiver": "Vom Empfänger angenommen",
  Cancelled: "Abgebrochen",
  Failed: "Fehlgeschlagen",
  Invalidated: "Ungültig gemacht",
  "Test acknowledged": "Test bestätigt",
  "Execution started": "Ausführung gestartet",
  Completed: "Abgeschlossen",
  // Connect, Help and Guide
  "Checking how this Crew is set up…":
    "Prüfe, wie dieses Crew eingerichtet ist…",
  "Could not check how this Crew is set up. Refresh to try again.":
    "Die Einrichtung dieses Crew konnte nicht geprüft werden. Aktualisiere, um es erneut zu versuchen.",
  "Open agent briefs": "Agent-Briefings öffnen",
  "Could not load connected apps. Refresh to try again.":
    "Verbundene Apps konnten nicht geladen werden. Aktualisiere, um es erneut zu versuchen.",
  "Disconnect {name}? It loses access right away.":
    "{name} trennen? Die App verliert sofort den Zugriff.",
  "Could not disconnect {name}. Try again.":
    "{name} konnte nicht getrennt werden. Versuche es erneut.",
  "Connected apps": "Verbundene Apps",
  "These apps can read and change notes and tasks, and request your review. They decide a review only when you ask them to in the conversation.":
    "Diese Apps können Notizen und Aufgaben lesen und ändern und deine Freigabe anfragen. Über eine Freigabe entscheiden sie nur, wenn du sie im Gespräch darum bittest.",
  "No apps connected yet.": "Noch keine Apps verbunden.",
  "Connected ": "Verbunden ",
  Disconnect: "Trennen",
  "Add this address to your agent platform":
    "Füge diese Adresse deiner Agent-Plattform hinzu",
  "Use it wherever your platform asks for an MCP server.":
    "Verwende sie überall dort, wo deine Plattform nach einem MCP-Server fragt.",
  "Approve the connection": "Verbindung bestätigen",
  "Your platform sends you here to sign in. Approve it with your owner account.":
    "Deine Plattform schickt dich zum Anmelden hierher. Bestätige sie mit deinem Inhaberkonto.",
  "Give each agent its brief": "Gib jedem Agenten sein Briefing",
  "Paste each brief into your platform. Crew doesn't run agents: scheduling and execution stay on your platform.":
    "Füge jedes Briefing in deine Plattform ein. Crew führt keine Agenten aus: Planung und Ausführung bleiben auf deiner Plattform.",
  "Install the Crew skill for your coding agent":
    "Installiere den Crew-Skill für deinen Coding-Agent",
  "Run this once in your Crew folder. It sets up Claude Code, Codex and Antigravity on this computer.":
    "Führe das einmal in deinem Crew-Ordner aus. Es richtet Claude Code, Codex und Antigravity auf diesem Computer ein.",
  "On Windows, the program is pocketcontext-crew.exe.":
    "Unter Windows heißt das Programm pocketcontext-crew.exe.",
  "Ask your agent to use Crew": "Bitte deinen Agenten, Crew zu nutzen",
  "There is no address to add. Your agent uses Crew with your owner access. It decides a review only when you ask it to in the conversation.":
    "Es gibt keine Adresse hinzuzufügen. Dein Agent nutzt Crew mit deinem Inhaberzugriff. Über eine Freigabe entscheidet er nur, wenn du ihn im Gespräch darum bittest.",
  "Paste each brief into your coding agent. Crew doesn't run agents: you start them yourself.":
    "Füge jedes Briefing in deinen Coding-Agent ein. Crew führt keine Agenten aus: Du startest sie selbst.",
  "Use Crew from another computer": "Crew von einem anderen Computer nutzen",
  "On the computer with Crew, keep the first command running. Run the second, then paste what it prints into the agent on the other computer.":
    "Lass auf dem Computer mit Crew den ersten Befehl laufen. Führe den zweiten aus und füge seine Ausgabe in den Agenten auf dem anderen Computer ein.",
  "Cloud assistants such as Grok, ChatGPT or Gemini on the web can't reach Crew without a domain.":
    "Cloud-Assistenten wie Grok, ChatGPT oder Gemini im Web erreichen Crew ohne Domain nicht.",
  "Optional: wake agents automatically": "Optional: Agenten automatisch wecken",
  "Wake-ups are meant for cloud bots. Without a domain, a woken cloud bot can't answer.":
    "Das Wecken ist für Cloud-Bots gedacht. Ohne Domain kann ein geweckter Cloud-Bot nicht antworten.",
  "Without this, agents only act when your platform runs them. With it, Crew tells them when work is ready.":
    "Ohne das handeln Agenten nur, wenn deine Plattform sie ausführt. Damit sagt Crew ihnen Bescheid, wenn Arbeit bereit ist.",
  "Learn more (opens in a new tab)": "Mehr erfahren (öffnet in neuem Tab)",
  "Learn more": "Mehr erfahren",
  "You create a task": "Du erstellst eine Aufgabe",
  "Describe the work on the Tasks board and assign an agent.":
    "Beschreibe die Arbeit auf dem Aufgaben-Board und weise einen Agenten zu.",
  "An agent drafts it": "Ein Agent schreibt einen Entwurf",
  "A connected agent does the work and sends a draft for approval.":
    "Ein verbundener Agent erledigt die Arbeit und reicht einen Entwurf zur Freigabe ein.",
  "You approve": "Du gibst frei",
  "Read the exact draft, then approve it, ask for changes or reject it.":
    "Lies den genauen Entwurf, dann gib ihn frei, fordere Änderungen an oder lehne ihn ab.",
  "The result is saved as a note": "Das Ergebnis wird als Notiz gespeichert",
  "You or the agent keep what's worth remembering as a note.":
    "Du oder der Agent haltet fest, was sich zu merken lohnt, als Notiz.",
  "Add this Crew's address to your agent platform from Connect an agent.":
    "Füge die Adresse dieses Crew unter Agent verbinden deiner Agent-Plattform hinzu.",
  "Install the skill for your coding agent from Connect an agent. This Crew has no domain, so there is no address to add.":
    "Installiere unter Agent verbinden den Skill für deinen Coding-Agent. Dieses Crew hat keine Domain, daher gibt es keine Adresse hinzuzufügen.",
  "Connect an agent shows the steps for this Crew.":
    "Agent verbinden zeigt die Schritte für dieses Crew.",
  "How Crew works": "So funktioniert Crew",
  "Good to know": "Gut zu wissen",
  "Approving never sends or publishes anything.":
    "Freigeben sendet oder veröffentlicht nie etwas.",
  "It records your decision. Anything outside Crew, you do yourself.":
    "Es hält deine Entscheidung fest. Alles außerhalb von Crew erledigst du selbst.",
  "Crew doesn't run agents.": "Crew führt keine Agenten aus.",
  "They run on your own platform or computer; Crew holds their tasks and notes.":
    "Sie laufen auf deiner eigenen Plattform oder deinem Computer; Crew verwaltet ihre Aufgaben und Notizen.",
  "Agents must be connected first.": "Agenten müssen zuerst verbunden werden.",
  "History is kept.": "Der Verlauf bleibt erhalten.",
  "Items are archived rather than deleted, and you can restore them.":
    "Einträge werden archiviert statt gelöscht, und du kannst sie wiederherstellen.",
  "Project agents and coding sessions": "Projekt-Agenten und Coding-Sitzungen",
  "One agent per project.": "Ein Agent pro Projekt.",
  "Create it with {option} and name it after the project, for example pocketcontext-crew. It needs no webhook.":
    "Erstelle ihn mit {option} und benenne ihn nach dem Projekt, zum Beispiel pocketcontext-crew. Er braucht keinen Webhook.",
  "I start it myself": "Ich starte ihn selbst",
  "Its queue is its Ready tasks.":
    "Seine Warteschlange sind seine bereiten Aufgaben.",
  "Assign tasks to it and set them Ready; those are what its sessions work on.":
    "Weise ihm Aufgaben zu und setze sie auf Bereit; daran arbeiten seine Sitzungen.",
  "Start a session from its card.": "Starte eine Sitzung über seine Karte.",
  "Copy coding prompt copies a short prompt to paste into a new Codex or Claude Code session; the ? beside it shows the steps.":
    "Coding-Prompt kopieren kopiert einen kurzen Prompt zum Einfügen in eine neue Codex- oder Claude-Code-Sitzung; das ? daneben zeigt die Schritte.",
  "Its instructions are saved in Crew.":
    "Seine Anweisungen sind in Crew gespeichert.",
  "Open Show full instructions to edit them by hand, see their history or restore the default. To change more than a line, use Rewrite with an agent: it copies a prompt for an agent conversation that saves only after you approve.":
    "Öffne Vollständige Anweisungen anzeigen, um sie von Hand zu bearbeiten, ihren Verlauf zu sehen oder den Standard wiederherzustellen. Für mehr als eine Zeile nutze Mit einem Agenten umschreiben: Das kopiert einen Prompt für ein Agent-Gespräch, das erst speichert, wenn du zustimmst.",
  "A session claims one task for 2 hours.":
    "Eine Sitzung übernimmt eine Aufgabe für 2 Stunden.",
  "It renews the claim while it works, and a second session can't take the same task.":
    "Sie verlängert die Übernahme, während sie arbeitet, und eine zweite Sitzung kann dieselbe Aufgabe nicht nehmen.",
  "An expired claim can be released.":
    "Eine abgelaufene Übernahme lässt sich freigeben.",
  "If a session stops, its task shows Claim expired. Open it and use Release claim to put it back in To do.":
    "Wenn eine Sitzung stoppt, zeigt ihre Aufgabe Übernahme abgelaufen. Öffne sie und nutze Übernahme freigeben, um sie zurück nach Zu erledigen zu setzen.",
  "What each page is for": "Wofür jede Seite da ist",
  "Open {page}": "{page} öffnen",
  "Words used in Crew": "Begriffe in Crew",
  // Help topics (helpContent; module text translated at render time)
  Home: "Start",
  "What is Home?": "Was ist Start?",
  "Your starting point. It shows what needs you, how much work is in each stage and what changed recently.":
    "Dein Ausgangspunkt. Hier siehst du, was dich braucht, wie viel Arbeit in jeder Phase ist und was sich zuletzt geändert hat.",
  "Deal with anything under Needs you first, then open the page you want.":
    "Kümmere dich zuerst um alles unter Braucht dich, dann öffne die gewünschte Seite.",
  Tasks: "Aufgaben",
  "What is the Tasks page?": "Was ist die Aufgaben-Seite?",
  "Every task and where it stands: To do, In progress, Needs review or Done. You or a connected agent can add tasks.":
    "Jede Aufgabe und ihr Stand: Zu erledigen, In Arbeit, Wartet auf Freigabe oder Erledigt. Du oder ein verbundener Agent könnt Aufgaben hinzufügen.",
  "Use New task to add work, or open a card to change its status, assigned agent or draft. Click an agent in the row under the search, or the agent on a card, to see only its tasks; click it again for all. The assignment filter also shows unassigned work or tasks that need a new agent. Sort sits beside Filters; Filters holds readiness, label and status, and clicking a label, Ready, On hold or Won't do chip on a card filters by it. Search also understands label:, agent: and status:. To mark what shipped together, use a label such as release-0.23.0.":
    "Mit Neue Aufgabe fügst du Arbeit hinzu, oder öffne eine Karte, um Status, zugewiesenen Agenten oder Entwurf zu ändern. Klicke auf einen Agenten in der Zeile unter der Suche oder auf den Agenten einer Karte, um nur seine Aufgaben zu sehen; klicke erneut für alle. Der Zuweisungsfilter zeigt auch nicht zugewiesene Arbeit oder Aufgaben, die einen neuen Agenten brauchen. Sortieren steht neben Filter; Filter enthält Bereitschaft, Label und Status, und ein Klick auf einen Label-, Bereit-, Angehalten- oder Wird-nicht-gemacht-Chip auf einer Karte filtert danach. Die Suche versteht auch label:, agent: und status:. Um zu markieren, was zusammen ausgeliefert wurde, nutze ein Label wie release-0.23.0.",
  Notes: "Notizen",
  "What is the Notes page?": "Was ist die Notizen-Seite?",
  "Notes every connected agent can read, grouped into buckets, so what was learned on one task carries over to the next.":
    "Notizen, die jeder verbundene Agent lesen kann, gruppiert in Buckets, damit das bei einer Aufgabe Gelernte bei der nächsten weiterhilft.",
  "Add a note for a decision, preference or finding worth keeping. Changing a note keeps its earlier versions. Select a bucket to show only its notes, use its Edit button to change it, and find notes with the search box at the top.":
    "Füge eine Notiz für eine Entscheidung, Vorliebe oder Erkenntnis hinzu, die es wert ist. Beim Ändern einer Notiz bleiben frühere Versionen erhalten. Wähle einen Bucket, um nur seine Notizen zu sehen, ändere ihn mit seinem Bearbeiten-Button und finde Notizen über das Suchfeld oben.",
  Approvals: "Freigaben",
  "What is the Shared page?": "Was ist die Seite „Geteilt“?",
  "Shared holds drafts and published pages. Anyone with the link can read a published page.": "Hier findest du Entwürfe und veröffentlichte Seiten. Wer den Link hat, kann die veröffentlichte Seite lesen.",
  "Create a draft or open an existing one. Review it before publishing, then copy its link.": "Erstelle oder öffne einen Entwurf. Prüfe ihn vor der Veröffentlichung und kopiere anschließend den Link.",
  "What are approvals?": "Was sind Freigaben?",
  "Drafts waiting for your decision, and your past decisions. Approving never sends or publishes anything.":
    "Entwürfe, die auf deine Entscheidung warten, und deine bisherigen Entscheidungen. Freigeben sendet oder veröffentlicht nie etwas.",
  "Open a draft, then Approve, Request changes or Reject it. Whatever you decide, the task goes back to In progress. Request changes also makes it Ready, so its bot picks the work up again.":
    "Öffne einen Entwurf und wähle Freigeben, Änderungen anfordern oder Ablehnen. Egal wie du entscheidest, die Aufgabe geht zurück auf In Arbeit. Änderungen anfordern setzt sie außerdem auf Bereit, damit ihr Bot die Arbeit wieder aufnimmt.",
  Agents: "Agenten",
  "What are agents?": "Was sind Agenten?",
  "The roles on your team. An agent here is a name and a brief, not a running program: Crew doesn't run agents.":
    "Die Rollen in deinem Team. Ein Agent ist hier ein Name und ein Briefing, kein laufendes Programm: Crew führt keine Agenten aus.",
  "Add agents or edit their briefs, then connect them from Connect an agent.":
    "Füge Agenten hinzu oder bearbeite ihre Briefings und verbinde sie dann unter Agent verbinden.",
  Archive: "Archiv",
  "What is the archive?": "Was ist das Archiv?",
  "Items you put away. Nothing is deleted: history is kept and you can bring items back.":
    "Einträge, die du weggelegt hast. Nichts wird gelöscht: Der Verlauf bleibt erhalten und du kannst Einträge zurückholen.",
  "Use Restore to bring something back. Approvals given earlier don't come back with it.":
    "Mit Wiederherstellen holst du etwas zurück. Früher erteilte Freigaben kommen dabei nicht mit zurück.",
  "Connect an agent": "Agent verbinden",
  "What does connecting an agent do?":
    "Was bewirkt das Verbinden eines Agenten?",
  "Links your agent platform to Crew with one address. Agents can't use Crew until this is done.":
    "Verbindet deine Agent-Plattform über eine Adresse mit Crew. Bis dahin können Agenten Crew nicht nutzen.",
  "Sets up your coding agent on this computer with a small installed skill. Agents can't use Crew until this is done.":
    "Richtet deinen Coding-Agent auf diesem Computer mit einem kleinen installierten Skill ein. Bis dahin können Agenten Crew nicht nutzen.",
  "Shows how agents reach this Crew. Agents can't use Crew until they are connected.":
    "Zeigt, wie Agenten dieses Crew erreichen. Agenten können Crew erst nutzen, wenn sie verbunden sind.",
  "Add the address to your platform, approve the connection, then give each agent its brief.":
    "Füge die Adresse deiner Plattform hinzu, bestätige die Verbindung und gib dann jedem Agenten sein Briefing.",
  "Run the command on this page once in your Crew folder, then give each agent its brief.":
    "Führe den Befehl auf dieser Seite einmal in deinem Crew-Ordner aus und gib dann jedem Agenten sein Briefing.",
  "Follow the steps on this page once they have loaded.":
    "Folge den Schritten auf dieser Seite, sobald sie geladen sind.",
  Search: "Suche",
  "How does search work?": "Wie funktioniert die Suche?",
  "Finds tasks and notes by the words in their titles, descriptions, drafts and note text, and agents and buckets by name. Every word must match; the last word also matches longer words that start with it.":
    "Findet Aufgaben und Notizen anhand der Wörter in Titeln, Beschreibungen, Entwürfen und Notiztext, Agenten und Buckets anhand ihres Namens. Jedes Wort muss passen; das letzte Wort passt auch auf längere Wörter, die damit beginnen.",
  "Type in the search box at the top of any page, or press / or Ctrl+K (⌘K on a Mac). Use the arrow keys and Enter to open a result, or See all results for the full list. Archived items appear only when you turn on Include archived.":
    "Tippe in das Suchfeld oben auf jeder Seite oder drücke / oder Strg+K (⌘K auf dem Mac). Öffne ein Ergebnis mit den Pfeiltasten und Enter oder nutze Alle Ergebnisse anzeigen für die ganze Liste. Archivierte Einträge erscheinen nur, wenn du Archivierte einbeziehen einschaltest.",
  "Get started": "Erste Schritte",
  "What is Get started?": "Was ist Erste Schritte?",
  "Four steps that take you from an empty Crew to your first reviewed draft.":
    "Vier Schritte, die dich von einem leeren Crew zu deinem ersten freigegebenen Entwurf führen.",
  "Do the current step. Don't show this again hides this list.":
    "Erledige den aktuellen Schritt. Nicht mehr anzeigen blendet diese Liste aus.",
  "Needs you": "Braucht dich",
  "What goes under Needs you?": "Was steht unter Braucht dich?",
  "How many drafts wait for your approval and how many open tasks are on hold, then the items that can't move without you: drafts waiting for approval, tasks stopped by the handoff limit and tasks whose assigned agent is unavailable.":
    "Wie viele Entwürfe auf deine Freigabe warten und wie viele offene Aufgaben angehalten sind, dann die Einträge, die ohne dich nicht weiterkommen: Entwürfe, die auf Freigabe warten, durch das Übergabelimit gestoppte Aufgaben und Aufgaben, deren zugewiesener Agent nicht verfügbar ist.",
  "Tap a count to open those items, or open an item to decide on it or fix it.":
    "Tippe auf eine Zahl, um diese Einträge zu öffnen, oder öffne einen Eintrag, um zu entscheiden oder ihn zu beheben.",
  "To do": "Zu erledigen",
  "What does To do mean?": "Was bedeutet Zu erledigen?",
  "Work that hasn't started yet.": "Arbeit, die noch nicht begonnen hat.",
  "Assign it to an agent and set it to Ready when it can begin.":
    "Weise sie einem Agenten zu und setze sie auf Bereit, wenn sie beginnen kann.",
  "In progress": "In Arbeit",
  "What does In progress mean?": "Was bedeutet In Arbeit?",
  "Work that has started. A task also comes back here after you decide on its draft, whatever you decided.":
    "Arbeit, die begonnen hat. Eine Aufgabe kommt auch hierher zurück, nachdem du über ihren Entwurf entschieden hast, egal wie.",
  "Open a task and use its Comments tab for the conversation and Activity for the full history. After an approval, do any step outside Crew yourself.":
    "Öffne eine Aufgabe und nutze den Tab Kommentare für das Gespräch und Aktivität für den ganzen Verlauf. Nach einer Freigabe erledigst du Schritte außerhalb von Crew selbst.",
  "Needs review": "Wartet auf Freigabe",
  "What does Needs review mean?": "Was bedeutet Wartet auf Freigabe?",
  "A draft was sent for your approval. A task only gets here that way: you can't pick this status by hand.":
    "Ein Entwurf wurde dir zur Freigabe geschickt. Nur so kommt eine Aufgabe hierher: Du kannst diesen Status nicht von Hand wählen.",
  "Open Approvals and decide on the draft.":
    "Öffne Freigaben und entscheide über den Entwurf.",
  Done: "Erledigt",
  "What does Done mean?": "Was bedeutet Erledigt?",
  "Finished work, plus tasks set to Won't do, most recently changed first; the last 7 days show unless you pick a label or Show older. Approval doesn't put a task here: you or an agent marks it Done. A coding session that you approve in the terminal adds a release label (for example release-0.23.0) and records \"Approved in session\".":
    'Abgeschlossene Arbeit und Aufgaben mit Wird nicht gemacht, zuletzt geänderte zuerst; angezeigt werden die letzten 7 Tage, außer du wählst ein Label oder Ältere anzeigen. Eine Freigabe bringt eine Aufgabe nicht hierher: Du oder ein Agent markiert sie als Erledigt. Eine Coding-Sitzung, die du im Terminal freigibst, fügt ein Release-Label hinzu (zum Beispiel release-0.23.0) und vermerkt "In der Sitzung freigegeben".',
  "Set the status to Done once everything is finished, including anything outside Crew, or Won't do when you decide against it. Tasks from the last 7 days show first; Show older reveals the rest.":
    "Setze den Status auf Erledigt, sobald alles fertig ist, auch außerhalb von Crew, oder auf Wird nicht gemacht, wenn du dich dagegen entscheidest. Aufgaben der letzten 7 Tage stehen zuerst; Ältere anzeigen zeigt den Rest.",
  Status: "Status",
  "What do the statuses mean?": "Was bedeuten die Status?",
  "To do: not started. In progress: being worked on. Needs review: a saved draft is waiting for your decision in Approvals. Done: finished. Won't do: decided against.":
    "Zu erledigen: nicht begonnen. In Arbeit: wird bearbeitet. Wartet auf Freigabe: ein gespeicherter Entwurf wartet unter Freigaben auf deine Entscheidung. Erledigt: fertig. Wird nicht gemacht: dagegen entschieden.",
  "Pick any status except Needs review: Crew sets that one itself when you or an agent requests approval for the saved draft, so there is always a snapshot to decide on. Your decision, withdrawing the request or editing the draft moves the task back to In progress.":
    "Wähle jeden Status außer Wartet auf Freigabe: Den setzt Crew selbst, wenn du oder ein Agent die Freigabe für den gespeicherten Entwurf anfragt, damit es immer einen Schnappschuss zum Entscheiden gibt. Deine Entscheidung, das Zurückziehen der Anfrage oder das Bearbeiten des Entwurfs setzt die Aufgabe zurück auf In Arbeit.",
  "Hold (On hold or Ready)": "Bereitschaft (Angehalten oder Bereit)",
  "What do On hold and Ready mean?": "Was bedeuten Angehalten und Bereit?",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned bot may act, and Crew can wake it if automatic wake-ups are on. Crew puts a task on hold by itself when its draft is edited, its review is withdrawn or the handoff limit is reached, and says why.":
    "Ob eine Aufgabe beginnen kann. Angehalten ist der Standard: Niemand wird geweckt und ein Mensch entscheidet. Bereit heißt, der zugewiesene Bot darf handeln, und Crew kann ihn wecken, wenn automatisches Wecken an ist. Crew hält eine Aufgabe von selbst an, wenn ihr Entwurf bearbeitet, ihre Freigabe zurückgezogen oder das Übergabelimit erreicht wird, und sagt warum.",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act; your agent sees this when you start it.":
    "Ob eine Aufgabe beginnen kann. Angehalten ist der Standard: Niemand wird geweckt und ein Mensch entscheidet. Bereit heißt, der zugewiesene Agent darf handeln; dein Agent sieht das, wenn du ihn startest.",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act.":
    "Ob eine Aufgabe beginnen kann. Angehalten ist der Standard: Niemand wird geweckt und ein Mensch entscheidet. Bereit heißt, der zugewiesene Agent darf handeln.",
  "Set Ready when the work can start. Assigning an agent doesn't do this for you, and a pending approval still blocks work. Putting a task on hold always works and stops any run in progress.":
    "Setze Bereit, wenn die Arbeit beginnen kann. Das Zuweisen eines Agenten erledigt das nicht für dich, und eine offene Freigabe blockiert die Arbeit weiterhin. Eine Aufgabe anzuhalten klappt immer und stoppt jeden laufenden Durchlauf.",
  "Assigned agent": "Zugewiesener Agent",
  "What is the assigned agent?": "Was ist der zugewiesene Agent?",
  "The agent meant to do this task. Agent names are reported attribution, not verified identities.":
    "Der Agent, der diese Aufgabe erledigen soll. Agentennamen sind gemeldete Zuordnungen, keine geprüften Identitäten.",
  "Pick an agent or leave it Unassigned. Assigning alone doesn't take a task off hold.":
    "Wähle einen Agenten oder lass Nicht zugewiesen stehen. Zuweisen allein hebt das Anhalten einer Aufgabe nicht auf.",
  "Handoff limit": "Übergabelimit",
  "What is the handoff limit?": "Was ist das Übergabelimit?",
  "How many times in a row agents can reassign a task before Crew stops it. A stopped task goes on hold and no agent is woken.":
    "Wie oft hintereinander Agenten eine Aufgabe neu zuweisen können, bevor Crew sie stoppt. Eine gestoppte Aufgabe wird angehalten und kein Agent wird geweckt.",
  "The default is 4 and you can set 1 to 20. Any edit or comment from you resets the count. An agent may set a stopped task Ready if you ask, but that keeps the count, so the next agent reassignment stops it again.":
    "Der Standard ist 4, einstellbar sind 1 bis 20. Jede Änderung oder jeder Kommentar von dir setzt den Zähler zurück. Ein Agent darf eine gestoppte Aufgabe auf Bereit setzen, wenn du ihn darum bittest, aber der Zähler bleibt, sodass die nächste Neuzuweisung durch einen Agenten sie wieder stoppt.",
  Bucket: "Bucket",
  "What is a bucket?": "Was ist ein Bucket?",
  "A named group of notes about one area of work, with an agent responsible for it.":
    "Eine benannte Gruppe von Notizen zu einem Arbeitsbereich, mit einem verantwortlichen Agenten.",
  "Make one for each area of work. Responsibility is a convention, not a permission: every connected agent can still read and write all buckets.":
    "Lege einen für jeden Arbeitsbereich an. Verantwortung ist eine Konvention, keine Berechtigung: Jeder verbundene Agent kann weiterhin alle Buckets lesen und schreiben.",
  "Responsible agent": "Verantwortlicher Agent",
  "What is the responsible agent?": "Was ist der verantwortliche Agent?",
  "The agent expected to look after this bucket's notes.":
    "Der Agent, der sich um die Notizen dieses Buckets kümmern soll.",
  "Pick one agent or leave it empty. Other agents are asked to request changes through tasks, but Crew doesn't enforce that.":
    "Wähle einen Agenten oder lass das Feld leer. Andere Agenten sollen Änderungen über Aufgaben anfragen, aber Crew erzwingt das nicht.",
  Note: "Notiz",
  "What is a note?": "Was ist eine Notiz?",
  "A page of Markdown in one bucket, such as a decision, a preference or a finding. Every saved change becomes a new revision.":
    "Eine Markdown-Seite in einem Bucket, etwa eine Entscheidung, eine Vorliebe oder eine Erkenntnis. Jede gespeicherte Änderung wird eine neue Revision.",
  "Keep what's worth remembering. Use History to see earlier versions; restoring one adds a new revision.":
    "Halte fest, was sich zu merken lohnt. Unter Verlauf siehst du frühere Versionen; eine wiederherzustellen fügt eine neue Revision hinzu.",
  Related: "Verknüpft",
  "What are related tasks and notes?":
    "Was sind verknüpfte Aufgaben und Notizen?",
  "Links from this item to other tasks and notes, so you and your agents can find the background. Items that link here show under Linked from.":
    "Links von diesem Eintrag zu anderen Aufgaben und Notizen, damit du und deine Agenten den Hintergrund findet. Einträge, die hierher verlinken, stehen unter Verlinkt von.",
  "Search for a task or note and add it. Linking doesn't change the item you link to, but it shows this item under Linked from.":
    "Suche eine Aufgabe oder Notiz und füge sie hinzu. Verlinken ändert den verlinkten Eintrag nicht, zeigt diesen Eintrag dort aber unter Verlinkt von.",
  Draft: "Entwurf",
  "What is a draft?": "Was ist ein Entwurf?",
  "The text you want approved, kept on the task. You or an agent can write it.":
    "Der Text, den du freigeben willst, gespeichert an der Aufgabe. Du oder ein Agent könnt ihn schreiben.",
  "Write it here and save. Changing a draft withdraws any pending approval for it.":
    "Schreib ihn hier und speichere. Eine Änderung am Entwurf zieht eine offene Freigabeanfrage dafür zurück.",
  "Request approval": "Freigabe anfragen",
  "What does Request approval do?": "Was bewirkt Freigabe anfragen?",
  "Saves the submitted text and options in Approvals and moves the task to Needs review.":
    "Speichert den eingereichten Text und die Optionen unter Freigaben und setzt die Aufgabe auf Wartet auf Freigabe.",
  "Save a draft or add options for the reviewer. If you change the draft later, request approval again.":
    "Speichere einen Entwurf oder füge Optionen zur Auswahl hinzu. Wenn du den Entwurf später änderst, frage die Freigabe erneut an.",
  "Reason for change": "Grund der Änderung",
  "Why give a reason for change?":
    "Warum einen Grund für die Änderung angeben?",
  "A short remark kept in this item's history, saying why you changed it.":
    "Ein kurzer Vermerk im Verlauf dieses Eintrags, warum du ihn geändert hast.",
  "Optional. Say what changed and why, so you and your agents can follow it later.":
    "Optional. Sag, was sich geändert hat und warum, damit du und deine Agenten es später nachvollziehen könnt.",
  Brief: "Briefing",
  "What is a brief?": "Was ist ein Briefing?",
  "The instructions for this agent: what it works on, which bucket is its own, when to hand off and what to save.":
    "Die Anweisungen für diesen Agenten: woran er arbeitet, welcher Bucket ihm gehört, wann er übergibt und was er speichert.",
  "Write it here, then paste it into the agent that will use it. Crew doesn't send it there for you.":
    "Schreib es hier und füge es dann in den Agenten ein, der es nutzen soll. Crew schickt es nicht für dich dorthin.",
  "How an agent is started": "Wie ein Agent gestartet wird",
  "How is an agent started?": "Wie wird ein Agent gestartet?",
  "Webhook (bot): Crew wakes it over a webhook when a Ready task can be worked on. I start it myself: a project agent, such as one per code repository, whose coding sessions you start in Codex or Claude Code; it has no webhook. Person: someone who does the work by hand.":
    "Webhook (Bot): Crew weckt ihn per Webhook, wenn an einer bereiten Aufgabe gearbeitet werden kann. Ich starte ihn selbst: ein Projekt-Agent, etwa einer pro Code-Repository, dessen Coding-Sitzungen du in Codex oder Claude Code startest; er hat keinen Webhook. Person: jemand, der die Arbeit von Hand erledigt.",
  "For a project agent, name it after the project, for example pocketcontext-crew, then use Start a session on its card.":
    "Benenne einen Projekt-Agenten nach dem Projekt, zum Beispiel pocketcontext-crew, und nutze dann Sitzung starten auf seiner Karte.",
  Claim: "Übernahme",
  "What is a claim?": "Was ist eine Übernahme?",
  "A coding session marks the one task it is working on as claimed for 2 hours, renewed while it works, so a second session can't take the same task. The claim names the session for your information; it isn't an identity.":
    "Eine Coding-Sitzung markiert die eine Aufgabe, an der sie arbeitet, für 2 Stunden als übernommen und verlängert das, solange sie arbeitet, damit eine zweite Sitzung dieselbe Aufgabe nicht nehmen kann. Die Übernahme nennt die Sitzung zu deiner Information; sie ist keine Identität.",
  "Nothing to do while it is live. Claim expired means the session stopped renewing it: release the claim to put the task back in To do.":
    "Solange sie aktiv ist, ist nichts zu tun. Übernahme abgelaufen heißt, die Sitzung hat sie nicht mehr verlängert: Gib die Übernahme frei, um die Aufgabe zurück nach Zu erledigen zu setzen.",
  MCP: "MCP",
  "What is MCP?": "Was ist MCP?",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has one MCP address that all your agents share.":
    "Model Context Protocol, ein verbreiteter Weg, KI-Apps mit externen Tools zu verbinden. Dieses Crew hat eine MCP-Adresse, die alle deine Agenten teilen.",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has no domain, so it has no MCP address.":
    "Model Context Protocol, ein verbreiteter Weg, KI-Apps mit externen Tools zu verbinden. Dieses Crew hat keine Domain und daher keine MCP-Adresse.",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. Only Crew installs with a domain offer it.":
    "Model Context Protocol, ein verbreiteter Weg, KI-Apps mit externen Tools zu verbinden. Nur Crew-Installationen mit Domain bieten es an.",
  "Paste the address wherever your platform asks for an MCP server.":
    "Füge die Adresse überall dort ein, wo deine Plattform nach einem MCP-Server fragt.",
  "Use the skill on Connect an agent instead.":
    "Nutze stattdessen den Skill unter Agent verbinden.",
  "Connect an agent shows what applies to this Crew.":
    "Agent verbinden zeigt, was für dieses Crew gilt.",
  Dispatcher: "Dispatcher",
  "What is the dispatcher?": "Was ist der Dispatcher?",
  "One existing bot that receives Crew's wake-up signals and passes each one to the right bot. It keeps its normal job.":
    "Ein vorhandener Bot, der die Wecksignale von Crew empfängt und jedes an den richtigen Bot weitergibt. Er behält seine normale Aufgabe.",
  "Choose the bot, then follow the steps here. Changing it pauses delivery and clears the previous webhook binding.":
    "Wähle den Bot und folge dann den Schritten hier. Ein Wechsel pausiert die Zustellung und löscht die bisherige Webhook-Bindung.",
  "Automatic wake-ups": "Automatisches Wecken",
  "What are automatic wake-ups?": "Was ist automatisches Wecken?",
  "Optional. Crew signals one of your Grok Bots over HTTPS when a Ready task can be worked on, so it doesn't wait for your platform to run it.":
    "Optional. Crew gibt einem deiner Grok Bots per HTTPS ein Signal, wenn an einer bereiten Aufgabe gearbeitet werden kann, damit er nicht wartet, bis deine Plattform ihn ausführt.",
  "Optional, and meant for cloud bots: Crew signals a Grok Bot over HTTPS when a Ready task can be worked on. Without a domain, a woken cloud bot can't answer.":
    "Optional und für Cloud-Bots gedacht: Crew gibt einem Grok Bot per HTTPS ein Signal, wenn an einer bereiten Aufgabe gearbeitet werden kann. Ohne Domain kann ein geweckter Cloud-Bot nicht antworten.",
  "Optional. Crew can signal a Grok Bot over HTTPS when a Ready task can be worked on. Connect an agent shows whether this suits your Crew.":
    "Optional. Crew kann einem Grok Bot per HTTPS ein Signal geben, wenn an einer bereiten Aufgabe gearbeitet werden kann. Agent verbinden zeigt, ob das zu deinem Crew passt.",
  "Follow the steps in order. Enabling delivery doesn't notify existing tasks.":
    "Folge den Schritten der Reihe nach. Das Aktivieren der Zustellung benachrichtigt keine bestehenden Aufgaben.",
  "You can skip this and start your coding agent yourself when there is work.":
    "Du kannst das überspringen und deinen Coding-Agent selbst starten, wenn es Arbeit gibt.",
  "Follow the steps in order if you want this.":
    "Folge den Schritten der Reihe nach, wenn du das möchtest.",
  "Webhook credentials": "Webhook-Zugangsdaten",
  "What are webhook credentials?": "Was sind Webhook-Zugangsdaten?",
  "The URL and secret key of your bot's routine, which let Crew send it wake-up signals.":
    "URL und geheimer Schlüssel der Routine deines Bots, mit denen Crew ihm Wecksignale senden kann.",
  "Copy them from the routine straight into this form, never into chat. They are stored encrypted, never shown again and not available to agents.":
    "Kopiere sie aus der Routine direkt in dieses Formular, nie in einen Chat. Sie werden verschlüsselt gespeichert, nie wieder angezeigt und sind für Agenten nicht verfügbar.",
  // Attachments, previews and upload API messages
  "The pending approval was withdrawn because the task changed. Send the draft for approval again when it's ready.":
    "Die offene Freigabe wurde zurückgezogen, weil sich die Aufgabe geändert hat. Fordere die Freigabe für den Entwurf erneut an, sobald er fertig ist.",
  "Your browser can't play {name}.":
    "Dein Browser kann {name} nicht abspielen.",
  "Loading {name}…": "{name} wird geladen …",
  "[Image: {alt}]": "[Bild: {alt}]",
  attachment: "Datei",
  "Image unavailable: {name}": "Bild nicht verfügbar: {name}",
  "Image removed: {name}": "Bild entfernt: {name}",
  "Open image: {name}": "Bild öffnen: {name}",
  Image: "Bild",
  "image on {domain}": "Bild auf {domain}",
  "image on another site": "Bild auf einer anderen Website",
  image: "Bild",
  "file removed": "Datei entfernt",
  "file unavailable": "Datei nicht verfügbar",
  "Could not load files.": "Dateien konnten nicht geladen werden.",
  "Save first.": "Zuerst speichern.",
  "The file was not attached.": "Die Datei wurde nicht angehängt.",
  "Could not remove the file.": "Die Datei konnte nicht entfernt werden.",
  "Could not restore the file.":
    "Die Datei konnte nicht wiederhergestellt werden.",
  "Could not create an upload link.":
    "Upload-Link konnte nicht erstellt werden.",
  "Get a new upload link": "Neuen Upload-Link holen",
  "Get upload link": "Upload-Link holen",
  "Link copied": "Link kopiert",
  "Copy upload link": "Upload-Link kopieren",
  "Could not copy automatically; copy it from above.":
    "Automatisches Kopieren fehlgeschlagen; kopiere den Link von oben.",
  "Manage upload links": "Upload-Links verwalten",
  "Download {name}": "{name} herunterladen",
  Download: "Herunterladen",
  file: "Datei",
  FILE: "DATEI",
  "Open {name}": "{name} öffnen",
  "Remove {name}? It moves to Removed files, where you can restore it.":
    "{name} entfernen? Die Datei kommt zu den entfernten Dateien, wo du sie wiederherstellen kannst.",
  Files: "Dateien",
  "{count} of 20": "{count} von 20",
  "Add files": "Dateien hinzufügen",
  "Choose files to add": "Dateien zum Hinzufügen auswählen",
  "Drop files here or paste a screenshot. Up to 20 MB each.":
    "Dateien hier ablegen oder einen Screenshot einfügen. Bis zu 20 MB pro Datei.",
  "They are saved with the new item.":
    "Sie werden mit dem neuen Eintrag gespeichert.",
  "Files not added": "Nicht hinzugefügte Dateien",
  Uploads: "Uploads",
  "Retry {name}": "{name} erneut versuchen",
  Retry: "Erneut versuchen",
  "Dismiss {name}": "{name} ausblenden",
  Dismiss: "Ausblenden",
  "Uploading {name}": "{name} wird hochgeladen",
  "Remove {name}": "{name} entfernen",
  Remove: "Entfernen",
  "Removed files ({n})": "Entfernte Dateien ({n})",
  "Restore {name}": "{name} wiederherstellen",
  Restore: "Wiederherstellen",
  "a file": "eine Datei",
  "via upload link": "per Upload-Link",
  "Owner / connection": "Inhaber / Verbindung",
  "Attached {name}": "{name} angehängt",
  "Removed {name}": "{name} entfernt",
  "Restored {name}": "{name} wiederhergestellt",
  "Created an upload link": "Upload-Link erstellt",
  "Revoked an upload link": "Upload-Link widerrufen",
  "Webhook activity": "Webhook-Aktivität",
  "Work activity": "Arbeitsaktivität",
  Change: "Änderung",
  "Open this link on your phone or another device to add up to {n} file to this note. It works once and expires {when}. It is shown only now.":
    "Öffne diesen Link auf deinem Handy oder einem anderen Gerät, um dieser Notiz bis zu {n} Datei hinzuzufügen. Er funktioniert einmal und läuft {when} ab. Er wird nur jetzt angezeigt.",
  "Open this link on your phone or another device to add up to {n} files to this note. It works once and expires {when}. It is shown only now.":
    "Öffne diesen Link auf deinem Handy oder einem anderen Gerät, um dieser Notiz bis zu {n} Dateien hinzuzufügen. Er funktioniert einmal und läuft {when} ab. Er wird nur jetzt angezeigt.",
  "Open this link on your phone or another device to add up to {n} file to this task. It works once and expires {when}. It is shown only now.":
    "Öffne diesen Link auf deinem Handy oder einem anderen Gerät, um dieser Aufgabe bis zu {n} Datei hinzuzufügen. Er funktioniert einmal und läuft {when} ab. Er wird nur jetzt angezeigt.",
  "Open this link on your phone or another device to add up to {n} files to this task. It works once and expires {when}. It is shown only now.":
    "Öffne diesen Link auf deinem Handy oder einem anderen Gerät, um dieser Aufgabe bis zu {n} Dateien hinzuzufügen. Er funktioniert einmal und läuft {when} ab. Er wird nur jetzt angezeigt.",
  "File: {name}": "Datei: {name}",
  "Close file preview": "Dateivorschau schließen",
  "File {n} of {count}: {name}": "Datei {n} von {count}: {name}",
  "No preview for this type of file.":
    "Für diesen Dateityp gibt es keine Vorschau.",
  "The preview could not be opened.":
    "Die Vorschau konnte nicht geöffnet werden.",
  "Opening {name}…": "{name} wird geöffnet …",
  "Preview width": "Vorschaubreite",
  Desktop: "Desktop",
  Mobile: "Mobil",
  "Open in new tab": "In neuem Tab öffnen",
  "Preview runs isolated from Crew": "Vorschau läuft isoliert von Crew",
  "Preview of {name}": "Vorschau von {name}",
  "Too large to preview.": "Zu groß für die Vorschau.",
  "The file could not be loaded.": "Die Datei konnte nicht geladen werden.",
  "Not valid text: this file is not UTF-8, so it can't be shown here.":
    "Kein gültiger Text: Diese Datei ist nicht UTF-8 und kann hier nicht angezeigt werden.",
  "Not valid JSON; showing the text as it is.":
    "Kein gültiges JSON; der Text wird unverändert angezeigt.",
  "Wrap lines": "Zeilen umbrechen",
  "The file is empty.": "Die Datei ist leer.",
  "Showing first {shown} of {total} rows.":
    "Die ersten {shown} von {total} Zeilen.",
  "[Image]": "[Bild]",
  "Can't play this format here.":
    "Dieses Format kann hier nicht abgespielt werden.",
  "This PDF is password protected and can't be shown here.":
    "Dieses PDF ist passwortgeschützt und kann hier nicht angezeigt werden.",
  "This PDF can't be shown here.":
    "Dieses PDF kann hier nicht angezeigt werden.",
  "Opening the PDF viewer…": "PDF-Ansicht wird geöffnet …",
  "The PDF viewer could not be loaded.":
    "Die PDF-Ansicht konnte nicht geladen werden.",
  "{n} row.": "{n} Zeile.",
  "{n} rows.": "{n} Zeilen.",
  "{name} is empty.": "{name} ist leer.",
  "{name} is larger than 20 MB ({size}).":
    "{name} ist größer als 20 MB ({size}).",
  "{name} was not added: a task or note holds at most 20 files.":
    "{name} wurde nicht hinzugefügt: Eine Aufgabe oder Notiz enthält höchstens 20 Dateien.",
  "{name} was not added: files saved with a new item are limited to 89 MB in total. Add it after saving.":
    "{name} wurde nicht hinzugefügt: Dateien, die mit einem neuen Eintrag gespeichert werden, sind auf insgesamt 89 MB begrenzt. Füge sie nach dem Speichern hinzu.",
  "This file was refused.": "Diese Datei wurde abgelehnt.",
  "Network error: the upload did not finish.":
    "Netzwerkfehler: Der Upload wurde nicht abgeschlossen.",
  "Upload cancelled.": "Upload abgebrochen.",
  "The upload is too large.": "Der Upload ist zu groß.",
  "Upload failed (HTTP {status}).": "Upload fehlgeschlagen (HTTP {status}).",
  "File access is unavailable.": "Dateizugriff ist nicht verfügbar.",
  "The file could not be loaded (HTTP {status}).":
    "Die Datei konnte nicht geladen werden (HTTP {status}).",
  Created: "Erstellt",
  Updated: "Aktualisiert",
  Comment: "Kommentar",
  Claimed: "Übernommen",
  "Claim renewed": "Übernahme verlängert",
  "Claim released": "Übernahme freigegeben",
  "Woke the assignee": "Zuständigen geweckt",
  "Stopped at the handoff limit": "Am Übergabelimit gestoppt",
  "Started by the assignee": "Vom Zuständigen gestartet",
  "Restored an earlier revision": "Frühere Version wiederhergestellt",
  "Review requested": "Freigabe angefragt",
  "Review decided": "Über Freigabe entschieden",
  "Review withdrawn": "Freigabe zurückgezogen",
  "Review restored": "Freigabe wiederhergestellt",
  "Responsibility changed": "Zuständigkeit geändert",
  "Draft created": "Entwurf erstellt",
  "Draft updated": "Entwurf aktualisiert",
  Published: "Veröffentlicht",
  "Published link replaced": "Veröffentlichter Link ersetzt",
  "Link revoked": "Link widerrufen",
  "Link expiry changed": "Ablauf des Links geändert",
  Archived: "Archiviert",
  Restored: "Wiederhergestellt",
  "Work started": "Arbeit begonnen",
  "Handed to the bot": "An den Bot übergeben",
  "Handed off": "Übergeben",
  "Work lease renewed": "Arbeitssperre verlängert",
  "Work finished": "Arbeit abgeschlossen",
  "Work cancelled": "Arbeit abgebrochen",
  "Work recovered": "Arbeit wiederhergestellt",
  // File viewer, PDF and page previews, file settings and the upload page
  "File {n} of {total}: {name}": "Datei {n} von {total}: {name}",
  "Image {n} of {total}: {name}": "Bild {n} von {total}: {name}",
  "Image viewer": "Bildbetrachter",
  "Close image viewer": "Bildbetrachter schließen",
  "Open original": "Original",
  "Open the original in a new tab": "Original in neuem Tab öffnen",
  "This page could not be shown.": "Diese Seite konnte nicht angezeigt werden.",
  "PDF pages": "PDF-Seiten",
  "Previous page": "Vorherige Seite",
  "Page {page} of {pages}": "Seite {page} von {pages}",
  "Opening…": "Wird geöffnet…",
  "Next page": "Nächste Seite",
  "Zoom out": "Verkleinern",
  "Zoom in": "Vergrößern",
  "Fit width": "Breite",
  "{name}, page {page}": "{name}, Seite {page}",
  "Page {page} of {name}": "Seite {page} von {name}",
  Zoom: "Zoom",
  "Zoom level": "Zoomstufe",
  Fit: "Passend",
  "Fit to screen": "An Bildschirm anpassen",
  "Actual size": "100 %",
  Viewer: "Betrachter",
  "Previous file": "Vorherige Datei",
  "Previous image": "Vorheriges Bild",
  "Previous file (←)": "Vorherige Datei (←)",
  "Previous image (←)": "Vorheriges Bild (←)",
  "Next file": "Nächste Datei",
  "Next image": "Nächstes Bild",
  "Next file (→)": "Nächste Datei (→)",
  "Next image (→)": "Nächstes Bild (→)",
  "Only images open as an original here":
    "Nur Bilder lassen sich hier als Original öffnen",
  "Enter a size in GB, for example 5 or 0.5.":
    "Gib eine Größe in GB ein, zum Beispiel 5 oder 0,5.",
  "The limit is at least 1 MB (0.001 GB).":
    "Das Limit beträgt mindestens 1 MB (0,001 GB).",
  "The limit is at most 1 TB (1024 GB).":
    "Das Limit beträgt höchstens 1 TB (1024 GB).",
  "This changed elsewhere. Reloaded; check and try again.":
    "Das wurde anderswo geändert. Neu geladen; prüfe es und versuche es erneut.",
  "Could not load file settings. Refresh to try again.":
    "Dateieinstellungen konnten nicht geladen werden. Aktualisiere, um es erneut zu versuchen.",
  "Storage limit saved.": "Speicherlimit gespeichert.",
  "Could not save the storage limit.":
    "Speicherlimit konnte nicht gespeichert werden.",
  "Revoke this upload link for “{title}”? It stops accepting files right away.":
    "Upload-Link für „{title}“ widerrufen? Er nimmt sofort keine Dateien mehr an.",
  "Revoke this upload link? It stops accepting files right away.":
    "Diesen Upload-Link widerrufen? Er nimmt sofort keine Dateien mehr an.",
  "Upload link revoked.": "Upload-Link widerrufen.",
  "Could not revoke the upload link.":
    "Upload-Link konnte nicht widerrufen werden.",
  "A note": "Eine Notiz",
  "A task": "Eine Aufgabe",
  "created ": "erstellt ",
  "expires ": "läuft ab ",
  "expired ": "abgelaufen ",
  "{added}/{max} files": "{added}/{max} Dateien",
  "Revoke upload link for {title}": "Upload-Link für {title} widerrufen",
  note: "Notiz",
  task: "Aufgabe",
  Revoke: "Widerrufen",
  Storage: "Speicher",
  "{used} of {max} used": "{used} von {max} belegt",
  "Storage used": "Belegter Speicher",
  "{used} of {max}": "{used} von {max}",
  "Storage limit (GB)": "Speicherlimit (GB)",
  "Save limit": "Limit speichern",
  "From 1 MB to 1 TB. Archived files count too: Crew never deletes files. A limit below what is used deletes nothing; new files are refused until you raise it.":
    "Von 1 MB bis 1 TB. Archivierte Dateien zählen mit: Crew löscht nie Dateien. Ein Limit unter dem belegten Speicher löscht nichts; neue Dateien werden abgelehnt, bis du es erhöhst.",
  "Upload links": "Upload-Links",
  "Create a link from a task or note. Each link works once and is shown only when it is created.":
    "Erstelle einen Link in einer Aufgabe oder Notiz. Jeder Link funktioniert einmal und wird nur beim Erstellen angezeigt.",
  "Active upload links": "Aktive Upload-Links",
  "No active upload links.": "Keine aktiven Upload-Links.",
  "Recent used, expired or revoked links ({n})":
    "Zuletzt benutzte, abgelaufene oder widerrufene Links ({n})",
  "Recent upload links": "Letzte Upload-Links",
  Active: "Aktiv",
  Used: "Benutzt",
  Expired: "Abgelaufen",
  Revoked: "Widerrufen",
  "Too many upload requests right now.": "Gerade zu viele Upload-Anfragen.",
  "Could not open this upload link. Check your connection and try again.":
    "Dieser Upload-Link konnte nicht geöffnet werden. Prüfe deine Verbindung und versuche es erneut.",
  "Empty file": "Leere Datei",
  "Larger than {size}": "Größer als {size}",
  "This link takes at most {max}. Remove {over}.":
    "Dieser Link nimmt höchstens {max} an. Entferne {over}.",
  "Remove the files marked below before sending.":
    "Entferne vor dem Senden die unten markierten Dateien.",
  "All files together must be at most {size}. Remove some files to send fewer at once.":
    "Alle Dateien zusammen dürfen höchstens {size} groß sein. Entferne einige, um weniger auf einmal zu senden.",
  "Network error: the files may not have arrived. Check your connection and send again.":
    "Netzwerkfehler: Die Dateien sind vielleicht nicht angekommen. Prüfe deine Verbindung und sende erneut.",
  "Another upload is in progress right now.":
    "Gerade läuft schon ein anderer Upload.",
  "These files are too large to send together. Remove some.":
    "Diese Dateien sind zusammen zu groß. Entferne einige.",
  "No file was added. Fix or remove the files below and send again.":
    "Keine Datei wurde hinzugefügt. Korrigiere oder entferne die Dateien unten und sende erneut.",
  "The upload failed (HTTP {status}).":
    "Der Upload ist fehlgeschlagen (HTTP {status}).",
  "Opening the upload link…": "Upload-Link wird geöffnet…",
  "Add screenshots": "Screenshots hinzufügen",
  "Try again in {n} seconds.": "Versuche es in {n} Sekunden erneut.",
  "Try again": "Erneut versuchen",
  "Upload link unavailable": "Upload-Link nicht verfügbar",
  "This link has expired or was already used. Ask for a new one.":
    "Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte um einen neuen.",
  "If your earlier send finished before the connection dropped, its files were added. Ask the person who shared the link to check.":
    "Wenn dein letztes Senden fertig war, bevor die Verbindung abbrach, wurden die Dateien hinzugefügt. Bitte die Person, die den Link geteilt hat, das zu prüfen.",
  "Partly done": "Teilweise erledigt",
  "{files} added to the note {title}.":
    "{files} zur Notiz {title} hinzugefügt.",
  "{files} added to the task {title}.":
    "{files} zur Aufgabe {title} hinzugefügt.",
  "Upload results": "Upload-Ergebnisse",
  Saved: "Gespeichert",
  "Not added": "Nicht hinzugefügt",
  "This link is now used. You can close this page.":
    "Dieser Link ist jetzt verbraucht. Du kannst diese Seite schließen.",
  "Add screenshots to:": "Screenshots hinzufügen zu:",
  "Up to {files}, {each} each, {total} in total. Any file type.":
    "Bis zu {files}, je {each}, insgesamt {total}. Jeder Dateityp.",
  "Choose photos or files": "Fotos oder Dateien auswählen",
  "You can also paste or drag files here.":
    "Du kannst Dateien auch hier einfügen oder hierher ziehen.",
  "Files to send": "Zu sendende Dateien",
  "{files}, {size}": "{files}, {size}",
  "Upload progress": "Upload-Fortschritt",
  "Sending {percent}%": "Wird gesendet {percent} %",
  "Sending…": "Wird gesendet…",
  "Send {files}": "{files} senden",
  Send: "Senden",
  "The link works for one send. Files are added to this note only; nothing else in Crew is visible here.":
    "Der Link funktioniert für ein Senden. Dateien werden nur zu dieser Notiz hinzugefügt; sonst ist hier nichts aus Crew sichtbar.",
  "The link works for one send. Files are added to this task only; nothing else in Crew is visible here.":
    "Der Link funktioniert für ein Senden. Dateien werden nur zu dieser Aufgabe hinzugefügt; sonst ist hier nichts aus Crew sichtbar.",
  "{n} file": "{n} Datei",
  "{n} files": "{n} Dateien",
  "Copy link": "Link kopieren",
  "Open in Safari": "In Safari öffnen",
  "Open in browser": "Im Browser öffnen",
  Share: "Teilen",
  "Shared page: {title}": "Geteilte Seite: {title}",
  Back: "Zurück",
  "Could not copy automatically: {url}":
    "Automatisches Kopieren fehlgeschlagen: {url}",
  "This page can only open outside Crew.":
    "Diese Seite lässt sich nur außerhalb von Crew öffnen.",
};

export default de;
