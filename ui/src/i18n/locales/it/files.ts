// Italian reader strings for files, previews, the upload page, Connect,
// wake-up setup, Help and the Guide. Keys are the English text (i18n/index.ts).
// Some keys come from tables translated where they render (wake rules,
// delivery states, history labels, link states, help topics); they are listed
// here too.
const it: Record<string, string> = {
  "First setup: start each Grok bot in a chat": "Prima configurazione: avvia ogni bot Grok in una chat",
  "Open Agents and copy the prompt beside “Start in a chat” on the matching Crew agent. If automatic startup is already on, use “Use in another chat”. Paste the prompt into that bot’s own Grok chat so it reads its Crew name, brief and saved instructions.": "Apri Agenti e copia il prompt accanto ad «Avvia in una chat» per l’agente Crew corrispondente. Se l’avvio automatico è già attivo, usa «Usa in un’altra chat». Incolla il prompt nella chat Grok di quel bot perché legga il proprio nome in Crew, il brief e le istruzioni salvate.",
  "Open Agents": "Apri Agenti",
  "Do this once per bot, including the dispatcher. Then return here to configure routing and authorize the bots. Each new task wake loads the latest saved instructions.": "Fallo una volta per ogni bot, incluso il dispatcher. Poi torna qui per configurare l’instradamento e autorizzare i bot. A ogni nuovo avvio per un’attività vengono caricate le ultime istruzioni salvate.",
  "Create an agent and name it after the project. You can start it in a connected chat.": "Crea un agente con il nome del progetto. Puoi avviarlo in una chat collegata.",
  "Start an agent in a connected chat by copying its instructions. To wake it automatically for ready tasks, connect an integration and enable automatic startup for that agent.": "Copia le istruzioni in una chat collegata per avviare un agente. Per avviarlo automaticamente quando le attività sono pronte, collega un’integrazione e attiva l’avvio automatico per quell’agente.",
  "Open the agent to see its instructions and startup settings.": "Apri l’agente per vedere le istruzioni e le impostazioni di avvio.",
  // Wake-up setup (WebhookStatus)
  "Unknown delivery status": "Stato di consegna sconosciuto",
  Complete: "Completato",
  "Hide prompt": "Nascondi prompt",
  "Read prompt": "Leggi prompt",
  "Could not load the integration. Crew will try again shortly.":
    "Impossibile caricare l'integrazione. Crew riproverà a breve.",
  "The saved routine's managed block does not match Crew. Apply the current block from step 2, then report synchronization again.":
    "Il blocco gestito della routine salvata non corrisponde a Crew. Applica il blocco attuale del passo 2, poi segnala di nuovo la sincronizzazione.",
  "Send the safe connection test and wait for the actual webhook routine to report its capabilities.":
    "Invia il test di connessione sicuro e attendi che la routine webhook effettiva segnali le sue capacità.",
  "The routine has not reported native messaging. If it uses WakeParent, select the parent bridge and apply its current instructions.":
    "La routine non ha segnalato la messaggistica nativa. Se usa WakeParent, seleziona il bridge parent e applica le sue istruzioni attuali.",
  "The routine has not reported WakeParent. Check its actual tools and run the connection test again.":
    "La routine non ha segnalato WakeParent. Controlla i suoi strumenti effettivi ed esegui di nuovo il test di connessione.",
  "The dispatcher parent has not acknowledged the wake. Check its Grok conversation before sending another test.":
    "Il parent del dispatcher non ha confermato il risveglio. Controlla la sua conversazione Grok prima di inviare un altro test.",
  "The dispatcher parent has not reported native bot messaging. Check its available tools.":
    "Il parent del dispatcher non ha segnalato la messaggistica nativa tra bot. Controlla i suoi strumenti disponibili.",
  "The dispatcher parent cannot use Crew's execution protocol. Refresh its tools before testing again.":
    "Il parent del dispatcher non può usare il protocollo di esecuzione di Crew. Aggiorna i suoi strumenti prima di testare di nuovo.",
  "Choose a mapped teammate and run the end-to-end test before enabling delivery.":
    "Scegli un membro del team associato ed esegui il test end-to-end prima di attivare la consegna.",
  "The recipient has not acknowledged the test. Check its Grok conversation and prior authorization; do not resend an uncertain message.":
    "Il destinatario non ha confermato il test. Controlla la sua conversazione Grok e l'autorizzazione precedente; non reinviare un messaggio incerto.",
  "Another execution is live on this task. The recipient must use execution.begin and the fenced task protocol, or wait for the live run to end.":
    "Su questa attività è già attiva un'altra esecuzione. Il destinatario deve usare execution.begin e il protocollo protetto dell'attività, oppure attendere la fine dell'esecuzione in corso.",
  "Send the safe connection test and wait for its acknowledgment.":
    "Invia il test di connessione sicuro e attendi la conferma.",
  "This configuration changed elsewhere. Review the latest settings and try again.":
    "Questa configurazione è stata modificata altrove. Controlla le impostazioni più recenti e riprova.",
  "The change could not be confirmed. Check the configuration and try again. Credentials are never included in this message.":
    "Impossibile confermare la modifica. Controlla la configurazione e riprova. Le credenziali non sono mai incluse in questo messaggio.",
  "Instructions not applied": "Istruzioni non applicate",
  "Matching saved text reported": "Testo salvato corrispondente segnalato",
  "Application reported": "Applicazione segnalata",
  "Choose an active dispatcher in step 1.":
    "Scegli un dispatcher attivo nel passo 1.",
  "Ask Grok to confirm the dispatcher's bot mapping using the setup prompt.":
    "Chiedi a Grok di confermare l'associazione del bot del dispatcher con il prompt di configurazione.",
  "Paste the webhook URL and secret in step 3.":
    "Incolla l'URL e il segreto del webhook nel passo 3.",
  "Apply instruction revision {n} in Grok using the setup prompt.":
    "Applica la revisione {n} delle istruzioni in Grok con il prompt di configurazione.",
  "Complete the connection test and refresh its acknowledgment before enabling.":
    "Completa il test di connessione e aggiorna la conferma prima di attivare.",
  "Could not copy. Open the prompt and copy its text manually.":
    "Impossibile copiare. Apri il prompt e copia il testo a mano.",
  "Credentials saved. No request was sent.":
    "Credenziali salvate. Nessuna richiesta è stata inviata.",
  "Saving changed wake rules turns delivery off, cancels queued wakes and interrupts bots working on Ready tasks. Turn delivery back on afterwards. Ready tasks are not woken again until you put them on hold, then set them Ready.":
    "Salvare regole di risveglio modificate disattiva la consegna, annulla i risvegli in coda e interrompe i bot che lavorano su attività pronte. Riattiva poi la consegna. Le attività pronte non vengono risvegliate di nuovo finché non le metti in pausa e poi di nuovo su Pronta.",
  "Saving changed wake rules cancels queued wakes and interrupts bots working on Ready tasks. Ready tasks are not woken again until you put them on hold, then set them Ready.":
    "Salvare regole di risveglio modificate annulla i risvegli in coda e interrompe i bot che lavorano su attività pronte. Le attività pronte non vengono risvegliate di nuovo finché non le metti in pausa e poi di nuovo su Pronta.",
  "Save the new wake rules?": "Salvare le nuove regole di risveglio?",
  "Wake rules saved. Delivery is off; turn it back on with Enable delivery.":
    "Regole di risveglio salvate. La consegna è disattivata; riattivala con Attiva consegna.",
  "Wake rules saved.": "Regole di risveglio salvate.",
  "Bot handoff limit saved.": "Limite di passaggi tra bot salvato.",
  "The handoff limit was saved, but the rule changes were not. {reason}":
    "Il limite di passaggi è stato salvato, ma le modifiche alle regole no. {reason}",
  "Set up automatic wake-ups": "Configura i risvegli automatici",
  "Grok Bot integration": "Integrazione Grok Bot",
  "Grok setup": "Configurazione Grok",
  "One existing bot receives Crew notifications and routes them to your team. Keep your normal bot roles and one shared MCP connection.":
    "Un bot esistente riceve le notifiche di Crew e le smista al tuo team. Mantieni i normali ruoli dei bot e una connessione MCP condivisa.",
  "One existing bot receives Crew notifications and routes them to your team. Keep your normal bot roles.":
    "Un bot esistente riceve le notifiche di Crew e le smista al tuo team. Mantieni i normali ruoli dei bot.",
  "Loading integration…": "Caricamento integrazione…",
  "No global integration is available yet. It appears here after the server upgrade completes.":
    "Nessuna integrazione globale ancora disponibile. Apparirà qui al termine dell'aggiornamento del server.",
  "Automatic wake-ups: on": "Risvegli automatici: attivi",
  "{mapped} of {total} agents mapped": "{mapped} di {total} agenti associati",
  "Hide setup": "Nascondi configurazione",
  "Review setup": "Rivedi configurazione",
  "Delivery enabled": "Consegna attiva",
  "Delivery disabled": "Consegna disattivata",
  "Dispatcher: {name}": "Dispatcher: {name}",
  "Not selected or inactive": "Non selezionato o inattivo",
  "Only Ready tasks can wake a bot. Enabling does not notify existing tasks.":
    "Solo le attività pronte possono risvegliare un bot. L'attivazione non notifica le attività esistenti.",
  "Choose your dispatcher": "Scegli il dispatcher",
  "Use an existing bot. It keeps its main job and also routes Crew notifications.":
    "Usa un bot esistente. Mantiene il suo compito principale e smista anche le notifiche di Crew.",
  "Crew dispatcher": "Dispatcher di Crew",
  "Dispatcher changed. Connect its routine before enabling delivery.":
    "Dispatcher cambiato. Collega la sua routine prima di attivare la consegna.",
  "Choose an agent": "Scegli un agente",
  "Changing the dispatcher pauses delivery and clears the previous webhook binding.":
    "Cambiare dispatcher sospende la consegna e rimuove il collegamento webhook precedente.",
  "Dispatch path": "Percorso di smistamento",
  "Dispatch path changed. Apply the current instructions and test again. Credentials were preserved.":
    "Percorso di smistamento cambiato. Applica le istruzioni attuali e testa di nuovo. Le credenziali sono state mantenute.",
  "Via the bot's parent conversation":
    "Tramite la conversazione parent del bot",
  "Directly inside the webhook routine": "Direttamente nella routine webhook",
  "The routine wakes its parent conversation, which can work or message a teammate.":
    "La routine risveglia la sua conversazione parent, che può lavorare o scrivere a un membro del team.",
  "Use direct dispatch only when native bot messaging is available inside the routine. For Grok routines with WakeParent, choose the parent conversation.":
    "Usa lo smistamento diretto solo se la messaggistica nativa tra bot è disponibile nella routine. Per le routine Grok con WakeParent, scegli la conversazione parent.",
  "Prepare Grok": "Prepara Grok",
  "Two prompts, in this order. Both are required.":
    "Due prompt, in quest'ordine. Servono entrambi.",
  "First: paste once into {name}'s Grok chat":
    "Prima: incolla una volta nella chat Grok di {name}",
  "your selected bot": "il bot selezionato",
  "It asks Grok to discover your bots, save mappings and apply the current routine instructions where its tools support them.":
    "Chiede a Grok di trovare i tuoi bot, salvare le associazioni e applicare le istruzioni attuali della routine dove i suoi strumenti lo consentono.",
  "Read setup prompt": "Leggi prompt di configurazione",
  "Setup prompt copied. It contains no credentials.":
    "Prompt di configurazione copiato. Non contiene credenziali.",
  "Copy setup prompt": "Copia prompt di configurazione",
  "Revision {n}": "Revisione {n}",
  "Apply instruction revision {n} in Grok. This page updates automatically.":
    "Applica la revisione {n} delle istruzioni in Grok. Questa pagina si aggiorna automaticamente.",
  "{mapped} of {total} agents mapped.": "{mapped} di {total} agenti associati.",
  "Not mapped": "Non associato",
  "Then: paste once into a Grok group with all your bots":
    "Poi: incolla una volta in un gruppo Grok con tutti i tuoi bot",
  "Create a group chat with you and {who}, then paste this there. Do it after the first prompt and before testing. Each bot needs your authorization directly: the first bot can't give it on your behalf.":
    "Crea una chat di gruppo con te e {who}, poi incolla questo lì. Fallo dopo il primo prompt e prima del test. Ogni bot ha bisogno della tua autorizzazione diretta: il primo bot non può darla a nome tuo.",
  "all {n} bots": "tutti i {n} bot",
  "your bot": "il tuo bot",
  "Read group authorization prompt": "Leggi prompt di autorizzazione di gruppo",
  "Group authorization prompt copied. Paste it once in the group with all your bots.":
    "Prompt di autorizzazione di gruppo copiato. Incollalo una volta nel gruppo con tutti i tuoi bot.",
  "Copy group authorization prompt": "Copia prompt di autorizzazione di gruppo",
  "Can't use a group? Paste into each bot's own chat":
    "Non puoi usare un gruppo? Incolla nella chat di ogni bot",
  "Read bot authorization prompt": "Leggi prompt di autorizzazione del bot",
  "Authorization prompt copied. Paste it into each bot's own conversation.":
    "Prompt di autorizzazione copiato. Incollalo nella conversazione di ogni bot.",
  "Copy bot authorization prompt": "Copia prompt di autorizzazione del bot",
  "Unmapped agents cannot receive Ready-task notifications. The setup prompt asks only about ambiguous matches.":
    "Gli agenti non associati non ricevono notifiche sulle attività pronte. Il prompt di configurazione chiede solo per le corrispondenze ambigue.",
  "Enter webhook credentials": "Inserisci le credenziali del webhook",
  "Copy the URL and key from the selected bot's Grok routine directly into Crew. Never paste them into chat.":
    "Copia l'URL e la chiave dalla routine Grok del bot selezionato direttamente in Crew. Non incollarli mai in chat.",
  "Endpoint: {endpoint}": "Endpoint: {endpoint}",
  configured: "configurato",
  "not configured": "non configurato",
  "Credential: {credential}": "Credenziale: {credential}",
  "Replace saved credentials": "Sostituisci le credenziali salvate",
  "Add credentials": "Aggiungi credenziali",
  "Replacement webhook URL": "Nuovo URL del webhook",
  "Webhook URL": "URL del webhook",
  "Replacement secret": "Nuovo segreto",
  "Webhook secret": "Segreto del webhook",
  "Saved values are never filled back in. Leave a field empty to keep it. Replacing the URL requires a new secret. Saving sends nothing.":
    "I valori salvati non vengono mai reinseriti. Lascia vuoto un campo per mantenerlo. Sostituire l'URL richiede un nuovo segreto. Il salvataggio non invia nulla.",
  "Save credentials": "Salva credenziali",
  "Verify the connection": "Verifica la connessione",
  "Test the complete route: routine, parent conversation, and selected recipient. This explicitly sends a diagnostic message to a teammate when selected, but performs no task work.":
    "Testa l'intero percorso: routine, conversazione parent e destinatario selezionato. Invia esplicitamente un messaggio diagnostico al membro del team selezionato, ma non svolge lavoro sulle attività.",
  "Send a connection test to the routine. It acknowledges the test without task work or forwarding.":
    "Invia un test di connessione alla routine. Conferma il test senza lavoro sulle attività né inoltro.",
  "Test recipient": "Destinatario del test",
  "Map a bot first": "Associa prima un bot",
  "(dispatcher)": "(dispatcher)",
  "Test queued. Acknowledgment progress updates here automatically. Do not send another test while the outcome is uncertain.":
    "Test in coda. Lo stato della conferma si aggiorna qui automaticamente. Non inviare un altro test finché l'esito è incerto.",
  "Send test": "Invia test",
  "Connection test progress": "Avanzamento del test di connessione",
  "Webhook:": "Webhook:",
  "no current delivery recorded": "nessuna consegna attuale registrata",
  "Routine:": "Routine:",
  "test acknowledged": "test confermato",
  "awaiting acknowledgment": "in attesa di conferma",
  "Routine capabilities:": "Capacità della routine:",
  reported: "segnalato",
  "awaiting report": "in attesa di segnalazione",
  "Parent wake capability:": "Capacità di risveglio del parent:",
  "Parent conversation:": "Conversazione parent:",
  "receipt recorded": "ricezione registrata",
  "awaiting receipt": "in attesa di ricezione",
  "Native send:": "Invio nativo:",
  "not reported": "non segnalato",
  "Recipient:": "Destinatario:",
  "not needed for this dispatcher-only test":
    "non necessario per questo test del solo dispatcher",
  "acknowledgment recorded": "conferma registrata",
  "Test acknowledgment overdue. Check the bot conversations and authorization before starting a new test. No automatic resend.":
    "Conferma del test in ritardo. Controlla le conversazioni dei bot e l'autorizzazione prima di avviare un nuovo test. Nessun reinvio automatico.",
  "Latest test recipient:": "Ultimo destinatario del test:",
  "Unavailable agent": "Agente non disponibile",
  "Receiver acceptance, parent receipt and recipient acknowledgment are separate stages. Reports are supplied by bots using the shared connection; they do not independently identify a bot or guarantee reliable delivery. Check Grok before retrying an uncertain outcome.":
    "Accettazione del ricevitore, ricezione del parent e conferma del destinatario sono fasi separate. Le segnalazioni arrivano dai bot tramite la connessione condivisa; non identificano un bot in modo indipendente né garantiscono una consegna affidabile. Controlla Grok prima di ritentare un esito incerto.",
  "Enable future notifications": "Attiva le notifiche future",
  "Enable delivery after checking the routine's setup. Existing tasks are not replayed.":
    "Attiva la consegna dopo aver controllato la configurazione della routine. Le attività esistenti non vengono reinviate.",
  "Delivery enabled. Existing tasks were not replayed.":
    "Consegna attivata. Le attività esistenti non sono state reinviate.",
  "Delivery disabled.": "Consegna disattivata.",
  "Disable delivery": "Disattiva consegna",
  "Enable delivery": "Attiva consegna",
  "Verify task routing (optional)":
    "Verifica lo smistamento delle attività (facoltativo)",
  "Use an explicit synthetic test to check work for the dispatcher itself and a handoff to another bot. This is separate from the harmless connection test.":
    "Usa un test sintetico esplicito per verificare il lavoro del dispatcher stesso e un passaggio a un altro bot. È separato dall'innocuo test di connessione.",
  "Dispatcher task:": "Attività del dispatcher:",
  "completed execution recorded": "esecuzione completata registrata",
  "not yet verified": "non ancora verificato",
  "Specialist task:": "Attività dello specialista:",
  "Read routing test prompt": "Leggi prompt del test di smistamento",
  "Routing test prompt copied. It authorizes only the described synthetic tasks.":
    "Prompt del test di smistamento copiato. Autorizza solo le attività sintetiche descritte.",
  "Copy routing test prompt": "Copia prompt del test di smistamento",
  "Enable delivery first, then run only the authorized sample tasks. Recorded completion is reported by the worker; check the resulting task and Grok conversation.":
    "Attiva prima la consegna, poi esegui solo le attività di esempio autorizzate. Il completamento registrato è segnalato dall'esecutore; controlla l'attività risultante e la conversazione Grok.",
  "Wake rules": "Regole di risveglio",
  "Reset to recommended": "Ripristina i consigliati",
  "Which changes wake a bot. A task must be Ready, not done and not waiting for approval before any rule can wake it.":
    "Quali modifiche risvegliano un bot. Un'attività deve essere pronta, non conclusa e non in attesa di approvazione prima che una regola possa risvegliarla.",
  "Wake a bot when": "Risveglia un bot quando",
  "Recommended: on": "Consigliato: attivo",
  "Recommended: off": "Consigliato: disattivo",
  "Triage agent: {name}.": "Agente di triage: {name}.",
  "No triage agent is chosen, so this wakes no one; your assistant can choose one. Turn it on only after that.":
    "Nessun agente di triage scelto, quindi non risveglia nessuno; il tuo assistente può sceglierne uno. Attivala solo dopo.",
  "Bot handoff limit": "Limite di passaggi tra bot",
  "Recommended: {n}": "Consigliato: {n}",
  "How many times in a row bots can pass a task to each other (1 to 20). When reached, the task goes on hold until you act. Any edit or comment from you resets the count; an agent setting it Ready does not.":
    "Quante volte di seguito i bot possono passarsi un'attività (da 1 a 20). Al raggiungimento, l'attività va in pausa finché non intervieni. Ogni tua modifica o commento azzera il conteggio; un agente che la imposta su Pronta no.",
  "Save wake rules": "Salva regole di risveglio",
  "Choose at least one rule.": "Scegli almeno una regola.",
  "Enter a whole number from 1 to 20.": "Inserisci un numero intero da 1 a 20.",
  "Wakes not received": "Risvegli non ricevuti",
  "Crew woke these bots but they never confirmed receiving the wake. Check each bot's conversation; Crew does not resend on its own.":
    "Crew ha risvegliato questi bot, ma non hanno mai confermato la ricezione. Controlla la conversazione di ogni bot; Crew non reinvia da solo.",
  "Untitled task": "Attività senza titolo",
  "The dispatcher": "Il dispatcher",
  "Overdue, due ": "In ritardo, prevista ",
  "Overdue since an unknown time": "In ritardo da un momento sconosciuto",
  "Notification activity": "Attività delle notifiche",
  "Receiver acceptance does not mean the task started or completed. Human review decisions remain separate.":
    "L'accettazione del ricevitore non significa che l'attività sia iniziata o completata. Le decisioni di approvazione umane restano separate.",
  "No deliveries recorded.": "Nessuna consegna registrata.",
  "Show all ({n})": "Mostra tutto ({n})",
  "Show fewer": "Mostra meno",
  "Showing the 30 most recent deliveries.":
    "Sono mostrate le 30 consegne più recenti.",
  "Advanced settings and recovery": "Impostazioni avanzate e ripristino",
  "{n} previous per-agent configurations are retained as disabled history.":
    "{n} configurazioni precedenti per agente sono conservate come cronologia disattivata.",
  "Bot mappings": "Associazioni dei bot",
  "Normally your assistant manages these from the setup prompt. Edit a reference only when you can resolve it unambiguously in Grok.":
    "Di solito le gestisce il tuo assistente dal prompt di configurazione. Modifica un riferimento solo se puoi risolverlo senza ambiguità in Grok.",
  "Bot mapping saved.": "Associazione del bot salvata.",
  "Managed instructions": "Istruzioni gestite",
  "{status}. Matching saved text is reported by the assistant; Crew does not independently inspect Grok.":
    "{status}. Il testo salvato corrispondente è segnalato dall'assistente; Crew non ispeziona Grok in modo indipendente.",
  "Routine reference: {ref}": "Riferimento della routine: {ref}",
  "Routine instructions": "Istruzioni della routine",
  "Managed instructions copied. No credentials are included.":
    "Istruzioni gestite copiate. Non includono credenziali.",
  "Copy instructions": "Copia istruzioni",
  "Role and reporting instructions": "Istruzioni di ruolo e di report",
  "Instructions saved. Delivery is off until the routine is applied, tested and enabled again.":
    "Istruzioni salvate. La consegna resta disattivata finché la routine non viene applicata, testata e riattivata.",
  "Bot role instructions": "Istruzioni sul ruolo del bot",
  "Reporting instructions": "Istruzioni di report",
  "These settings stay outside Crew's managed block. After changing them, apply and report the saved routine again.":
    "Queste impostazioni restano fuori dal blocco gestito di Crew. Dopo averle modificate, applica e segnala di nuovo la routine salvata.",
  "Save instructions": "Salva istruzioni",
  "Retry authorized. Ask the intended recipient to resume this execution; no webhook or message was sent.":
    "Nuovo tentativo autorizzato. Chiedi al destinatario previsto di riprendere questa esecuzione; non è stato inviato alcun webhook né messaggio.",
  "Coordinated work cancelled. External actions were not undone.":
    "Lavoro coordinato annullato. Le azioni esterne non sono state annullate.",
  "{name} bot ({ref})": "Bot di {name} ({ref})",
  "{name} routing": "Smistamento per {name}",
  "Grok Bot reference for {name}": "Riferimento Grok Bot per {name}",
  "Confirmed bot reference": "Riferimento del bot confermato",
  "Bot display name for {name} (optional)":
    "Nome visualizzato del bot per {name} (facoltativo)",
  "Name shown in Grok": "Nome mostrato in Grok",
  "Save {name} mapping": "Salva associazione di {name}",
  "Dispatcher started": "Dispatcher avviato",
  "Handoff prepared": "Passaggio preparato",
  "Handoff reported": "Passaggio segnalato",
  "Recipient started": "Destinatario avviato",
  "Execution recorded": "Esecuzione registrata",
  "Later activity replaced this attempt; nothing to do here.":
    "Un'attività successiva ha sostituito questo tentativo; qui non c'è nulla da fare.",
  "This is more than a day old. Review the bot conversation only if the outcome still matters.":
    "Risale a più di un giorno fa. Controlla la conversazione del bot solo se l'esito conta ancora.",
  "Task wake for {name}": "Risveglio attività per {name}",
  "Task wake": "Risveglio attività",
  "Connection test": "Test di connessione",
  "Recipient acknowledgment overdue": "Conferma del destinatario in ritardo",
  "Waiting for recipient acquisition":
    "In attesa della presa in carico del destinatario",
  "{time} elapsed": "{time} trascorsi",
  "Review the bot conversation before recovery. No automatic resend.":
    "Controlla la conversazione del bot prima del ripristino. Nessun reinvio automatico.",
  "A reported send is not proof that the recipient started.":
    "Un invio segnalato non prova che il destinatario abbia iniziato.",
  "Execution lease expired ": "Lease di esecuzione scaduto ",
  "Execution lease expires ": "Lease di esecuzione in scadenza ",
  "Reconcile the outcome before authorizing another attempt.":
    "Verifica l'esito prima di autorizzare un altro tentativo.",
  "Recover interrupted work ({n})": "Recupera lavoro interrotto ({n})",
  "The bot may already have performed external work. Review the bot conversation and affected systems before deciding. Cancelling cannot undo external actions.":
    "Il bot potrebbe aver già svolto lavoro esterno. Controlla la conversazione del bot e i sistemi coinvolti prima di decidere. L'annullamento non può annullare le azioni esterne.",
  "Execution to recover": "Esecuzione da recuperare",
  "Choose an execution": "Scegli un'esecuzione",
  Task: "Attività",
  Unknown: "Sconosciuto",
  "I reviewed the uncertain outcome and any external actions.":
    "Ho verificato l'esito incerto e le eventuali azioni esterne.",
  "Cancel coordinated work": "Annulla lavoro coordinato",
  "Authorize another attempt": "Autorizza un altro tentativo",
  "Retry authorizes another acquisition of this execution. It does not send a webhook or message. Ask the intended bot to resume it after authorization. Cancelling coordination cannot stop a run already in progress or undo external actions.":
    "Il nuovo tentativo autorizza un'altra presa in carico di questa esecuzione. Non invia webhook né messaggi. Chiedi al bot previsto di riprenderla dopo l'autorizzazione. Annullare il coordinamento non ferma un'esecuzione già in corso né annulla le azioni esterne.",
  "{n} attempt": "{n} tentativo",
  "{n} attempts": "{n} tentativi",
  "Created ready": "Creata pronta",
  Assigned: "Assegnata",
  Reassigned: "Riassegnata",
  "Marked ready": "Impostata su Pronta",
  Reopened: "Riaperta",
  "Review resolved": "Approvazione risolta",
  "Unassigned (triage)": "Non assegnata (triage)",
  "Explicit catch-up": "Recupero esplicito",
  "Owner comment": "Commento del proprietario",
  "Wakes the assigned bot when a task is created already Ready. Off: such tasks wait until something else wakes them.":
    "Risveglia il bot assegnato quando un'attività viene creata già pronta. Disattiva: queste attività aspettano che qualcos'altro le risvegli.",
  "Wakes the bot a Ready task is assigned to. Off: assigning alone wakes no one.":
    "Risveglia il bot a cui viene assegnata un'attività pronta. Disattiva: la sola assegnazione non risveglia nessuno.",
  "Wakes the new bot when a Ready task moves from one bot to another. Off: handoffs between bots stall.":
    "Risveglia il nuovo bot quando un'attività pronta passa da un bot a un altro. Disattiva: i passaggi tra bot si bloccano.",
  "Wakes the assigned bot when a task on hold is set Ready, the normal way to release work. Off: setting Ready wakes no one.":
    "Risveglia il bot assegnato quando un'attività in pausa viene impostata su Pronta, il modo normale per avviare il lavoro. Disattiva: impostare Pronta non risveglia nessuno.",
  "Wakes the assigned bot when a Ready task is reopened from Done or restored from the archive. Off: it waits until something else wakes it.":
    "Risveglia il bot assegnato quando un'attività pronta viene riaperta da Fatto o ripristinata dall'archivio. Disattiva: aspetta che qualcos'altro la risvegli.",
  "Wakes the assigned bot when a review is decided or withdrawn, so it can continue. Off: it waits until something else wakes it.":
    "Risveglia il bot assegnato quando un'approvazione viene decisa o ritirata, così può continuare. Disattiva: aspetta che qualcos'altro la risvegli.",
  "Wakes the triage agent when a Ready task loses its assignee. Off: such tasks wait for you.":
    "Risveglia l'agente di triage quando un'attività pronta perde l'assegnatario. Disattiva: queste attività aspettano te.",
  "Lets you or your assistant ask for a catch-up wake on chosen Ready tasks. Never fires on its own. Off: catch-up requests are refused.":
    "Permette a te o al tuo assistente di chiedere un risveglio di recupero per attività pronte scelte. Non scatta mai da solo. Disattiva: le richieste di recupero vengono rifiutate.",
  "Wakes the assigned bot when you comment on a Ready task in the browser; agent comments never wake. Turn on if you steer bots through comments. Off: comments are only recorded.":
    "Risveglia il bot assegnato quando commenti un'attività pronta nel browser; i commenti degli agenti non risvegliano mai. Attivala se guidi i bot con i commenti. Disattiva: i commenti vengono solo registrati.",
  Queued: "In coda",
  Sending: "Invio in corso",
  "Accepted by receiver": "Accettata dal ricevitore",
  Cancelled: "Annullata",
  Failed: "Non riuscita",
  Invalidated: "Invalidata",
  "Test acknowledged": "Test confermato",
  "Execution started": "Esecuzione avviata",
  Completed: "Completata",
  // Connect, Help and Guide
  "Checking how this Crew is set up…":
    "Verifica della configurazione di questo Crew…",
  "Could not check how this Crew is set up. Refresh to try again.":
    "Impossibile verificare la configurazione di questo Crew. Aggiorna per riprovare.",
  "Open agent briefs": "Apri i brief degli agenti",
  "Could not load connected apps. Refresh to try again.":
    "Impossibile caricare le app collegate. Aggiorna per riprovare.",
  "Disconnect {name}? It loses access right away.":
    "Scollegare {name}? Perderà subito l'accesso.",
  "Could not disconnect {name}. Try again.":
    "Impossibile scollegare {name}. Riprova.",
  "Connected apps": "App collegate",
  "These apps can read and change notes and tasks, and request your review. They decide a review only when you ask them to in the conversation.":
    "Queste app possono leggere e modificare note e attività e chiedere la tua approvazione. Decidono un'approvazione solo se glielo chiedi nella conversazione.",
  "No apps connected yet.": "Nessuna app collegata.",
  "Connected ": "Collegata ",
  Disconnect: "Scollega",
  "Add this address to your agent platform":
    "Aggiungi questo indirizzo alla tua piattaforma di agenti",
  "Use it wherever your platform asks for an MCP server.":
    "Usalo ovunque la tua piattaforma chieda un server MCP.",
  "Approve the connection": "Approva la connessione",
  "Your platform sends you here to sign in. Approve it with your owner account.":
    "La tua piattaforma ti manda qui per accedere. Approvala con il tuo account proprietario.",
  "Give each agent its brief": "Dai a ogni agente il suo brief",
  "Paste each brief into your platform. Crew doesn't run agents: scheduling and execution stay on your platform.":
    "Incolla ogni brief nella tua piattaforma. Crew non esegue agenti: pianificazione ed esecuzione restano sulla tua piattaforma.",
  "Install the Crew skill for your coding agent":
    "Installa la skill di Crew per il tuo agente di coding",
  "Run this once in your Crew folder. It sets up Claude Code, Codex and Antigravity on this computer.":
    "Eseguilo una volta nella cartella di Crew. Configura Claude Code, Codex e Antigravity su questo computer.",
  "On Windows, the program is pocketcontext-crew.exe.":
    "Su Windows il programma è pocketcontext-crew.exe.",
  "Ask your agent to use Crew": "Chiedi al tuo agente di usare Crew",
  "There is no address to add. Your agent uses Crew with your owner access. It decides a review only when you ask it to in the conversation.":
    "Non c'è nessun indirizzo da aggiungere. Il tuo agente usa Crew con il tuo accesso da proprietario. Decide un'approvazione solo se glielo chiedi nella conversazione.",
  "Paste each brief into your coding agent. Crew doesn't run agents: you start them yourself.":
    "Incolla ogni brief nel tuo agente di coding. Crew non esegue agenti: li avvii tu.",
  "Use Crew from another computer": "Usa Crew da un altro computer",
  "On the computer with Crew, keep the first command running. Run the second, then paste what it prints into the agent on the other computer.":
    "Sul computer con Crew, lascia in esecuzione il primo comando. Esegui il secondo, poi incolla ciò che stampa nell'agente sull'altro computer.",
  "Cloud assistants such as Grok, ChatGPT or Gemini on the web can't reach Crew without a domain.":
    "Gli assistenti cloud come Grok, ChatGPT o Gemini sul web non raggiungono Crew senza un dominio.",
  "Optional: wake agents automatically":
    "Facoltativo: risveglia gli agenti automaticamente",
  "Wake-ups are meant for cloud bots. Without a domain, a woken cloud bot can't answer.":
    "I risvegli sono pensati per i bot cloud. Senza un dominio, un bot cloud risvegliato non può rispondere.",
  "Without this, agents only act when your platform runs them. With it, Crew tells them when work is ready.":
    "Senza questo, gli agenti agiscono solo quando la tua piattaforma li esegue. Con questo, Crew li avvisa quando c'è lavoro pronto.",
  "Learn more (opens in a new tab)":
    "Scopri di più (si apre in una nuova scheda)",
  "Learn more": "Scopri di più",
  "You create a task": "Crei un'attività",
  "Describe the work on the Tasks board and assign an agent.":
    "Descrivi il lavoro nella bacheca Attività e assegna un agente.",
  "An agent drafts it": "Un agente prepara una bozza",
  "A connected agent does the work and sends a draft for approval.":
    "Un agente collegato svolge il lavoro e invia una bozza per l'approvazione.",
  "You approve": "Approvi",
  "Read the exact draft, then approve it, ask for changes or reject it.":
    "Leggi la bozza esatta, poi approvala, chiedi modifiche o rifiutala.",
  "The result is saved as a note": "Il risultato viene salvato come nota",
  "You or the agent keep what's worth remembering as a note.":
    "Tu o l'agente conservate come nota ciò che vale la pena ricordare.",
  "Add this Crew's address to your agent platform from Connect an agent.":
    "Aggiungi l'indirizzo di questo Crew alla tua piattaforma di agenti da Collega un agente.",
  "Install the skill for your coding agent from Connect an agent. This Crew has no domain, so there is no address to add.":
    "Installa la skill per il tuo agente di coding da Collega un agente. Questo Crew non ha un dominio, quindi non c'è un indirizzo da aggiungere.",
  "Connect an agent shows the steps for this Crew.":
    "Collega un agente mostra i passaggi per questo Crew.",
  "How Crew works": "Come funziona Crew",
  "Good to know": "Buono a sapersi",
  "Approving never sends or publishes anything.":
    "Approvare non invia né pubblica mai nulla.",
  "It records your decision. Anything outside Crew, you do yourself.":
    "Registra la tua decisione. Tutto ciò che è fuori da Crew lo fai tu.",
  "Crew doesn't run agents.": "Crew non esegue agenti.",
  "They run on your own platform or computer; Crew holds their tasks and notes.":
    "Girano sulla tua piattaforma o sul tuo computer; Crew conserva le loro attività e note.",
  "Agents must be connected first.": "Prima bisogna collegare gli agenti.",
  "History is kept.": "La cronologia viene conservata.",
  "Items are archived rather than deleted, and you can restore them.":
    "Gli elementi vengono archiviati anziché eliminati e puoi ripristinarli.",
  "Project agents and coding sessions":
    "Agenti di progetto e sessioni di coding",
  "One agent per project.": "Un agente per progetto.",
  "Create it with {option} and name it after the project, for example pocketcontext-crew. It needs no webhook.":
    "Crealo con {option} e dagli il nome del progetto, per esempio pocketcontext-crew. Non serve un webhook.",
  "I start it myself": "Lo avvio io",
  "Its queue is its Ready tasks.": "La sua coda sono le sue attività pronte.",
  "Assign tasks to it and set them Ready; those are what its sessions work on.":
    "Assegnagli attività e impostale su Pronta; sono quelle su cui lavorano le sue sessioni.",
  "Start a session from its card.": "Avvia una sessione dalla sua scheda.",
  "Copy coding prompt copies a short prompt to paste into a new Codex or Claude Code session; the ? beside it shows the steps.":
    "Copia prompt di coding copia un breve prompt da incollare in una nuova sessione di Codex o Claude Code; il ? accanto mostra i passaggi.",
  "Its instructions are saved in Crew.":
    "Le sue istruzioni sono salvate in Crew.",
  "Open Show full instructions to edit them by hand, see their history or restore the default. To change more than a line, use Rewrite with an agent: it copies a prompt for an agent conversation that saves only after you approve.":
    "Apri Mostra istruzioni complete per modificarle a mano, vederne la cronologia o ripristinare quelle predefinite. Per cambiare più di una riga, usa Riscrivi con un agente: copia un prompt per una conversazione con un agente che salva solo dopo la tua approvazione.",
  "A session claims one task for 2 hours.":
    "Una sessione prende in carico un'attività per 2 ore.",
  "It renews the claim while it works, and a second session can't take the same task.":
    "Rinnova la presa in carico mentre lavora, e una seconda sessione non può prendere la stessa attività.",
  "An expired claim can be released.":
    "Una presa in carico scaduta può essere rilasciata.",
  "If a session stops, its task shows Claim expired. Open it and use Release claim to put it back in To do.":
    "Se una sessione si ferma, la sua attività mostra Presa in carico scaduta. Aprila e usa Rilascia presa in carico per rimetterla in Da fare.",
  "What each page is for": "A cosa serve ogni pagina",
  "Open {page}": "Apri {page}",
  "Words used in Crew": "Termini usati in Crew",
  // Help topics (helpContent; module text translated at render time)
  Home: "Home",
  "What is Home?": "Cos'è Home?",
  "Your starting point. It shows what needs you, how much work is in each stage and what changed recently.":
    "Il tuo punto di partenza. Mostra cosa richiede il tuo intervento, quanto lavoro c'è in ogni fase e cosa è cambiato di recente.",
  "Deal with anything under Needs you first, then open the page you want.":
    "Occupati prima di tutto ciò che è in Serve a te, poi apri la pagina che vuoi.",
  Tasks: "Attività",
  "What is the Tasks page?": "Cos'è la pagina Attività?",
  "Every task and where it stands: To do, In progress, Needs review or Done. You or a connected agent can add tasks.":
    "Ogni attività e il suo stato: Da fare, In corso, In revisione o Fatto. Tu o un agente collegato potete aggiungere attività.",
  "Use New task to add work, or open a card to change its status, assigned agent or draft. Click an agent in the row under the search, or the agent on a card, to see only its tasks; click it again for all. The assignment filter also shows unassigned work or tasks that need a new agent. Sort sits beside Filters; Filters holds readiness, label and status, and clicking a label, Ready, On hold or Won't do chip on a card filters by it. Search also understands label:, agent: and status:. To mark what shipped together, use a label such as release-0.23.0.":
    "Usa Nuova attività per aggiungere lavoro, oppure apri una scheda per cambiarne stato, agente assegnato o bozza. Fai clic su un agente nella riga sotto la ricerca, o sull'agente di una scheda, per vedere solo le sue attività; fai di nuovo clic per vederle tutte. Il filtro di assegnazione mostra anche il lavoro non assegnato o le attività che richiedono un nuovo agente. Ordina è accanto a Filtri; Filtri contiene disponibilità, etichetta e stato, e fare clic su un chip di etichetta, Pronta, In pausa o Non si farà in una scheda filtra per quel valore. La ricerca capisce anche label:, agent: e status:. Per indicare cosa è stato rilasciato insieme, usa un'etichetta come release-0.23.0.",
  Notes: "Note",
  "What is the Notes page?": "Cos'è la pagina Note?",
  "Notes every connected agent can read, grouped into buckets, so what was learned on one task carries over to the next.":
    "Note che ogni agente collegato può leggere, raggruppate in bucket, così ciò che si è imparato in un'attività serve nella successiva.",
  "Add a note for a decision, preference or finding worth keeping. Changing a note keeps its earlier versions. Select a bucket to show only its notes, use its Edit button to change it, and find notes with the search box at the top.":
    "Aggiungi una nota per una decisione, una preferenza o una scoperta da conservare. Modificare una nota ne mantiene le versioni precedenti. Seleziona un bucket per vedere solo le sue note, usa il suo pulsante Modifica per cambiarlo e trova le note con la casella di ricerca in alto.",
  Approvals: "Approvazioni",
  "What is the Shared page?": "A cosa serve la pagina Condivisi?",
  "Shared holds drafts and published pages. Anyone with the link can read a published page.": "Qui trovi bozze e pagine pubblicate. Chiunque abbia il link può leggere una pagina pubblicata.",
  "Create a draft or open an existing one. Review it before publishing, then copy its link.": "Crea una bozza o aprine una esistente. Rileggila prima di pubblicarla, poi copia il link.",
  "What are approvals?": "Cosa sono le approvazioni?",
  "Drafts waiting for your decision, and your past decisions. Approving never sends or publishes anything.":
    "Bozze in attesa della tua decisione e le tue decisioni passate. Approvare non invia né pubblica mai nulla.",
  "Open a draft, then Approve, Request changes or Reject it. Whatever you decide, the task goes back to In progress. Request changes also makes it Ready, so its bot picks the work up again.":
    "Apri una bozza, poi scegli Approva, Richiedi modifiche o Rifiuta. Qualunque cosa decidi, l'attività torna In corso. Richiedi modifiche la imposta anche su Pronta, così il suo bot riprende il lavoro.",
  Agents: "Agenti",
  "What are agents?": "Cosa sono gli agenti?",
  "The roles on your team. An agent here is a name and a brief, not a running program: Crew doesn't run agents.":
    "I ruoli del tuo team. Qui un agente è un nome e un brief, non un programma in esecuzione: Crew non esegue agenti.",
  "Add agents or edit their briefs, then connect them from Connect an agent.":
    "Aggiungi agenti o modifica i loro brief, poi collegali da Collega un agente.",
  Archive: "Archivio",
  "What is the archive?": "Cos'è l'archivio?",
  "Items you put away. Nothing is deleted: history is kept and you can bring items back.":
    "Elementi che hai messo da parte. Non viene eliminato nulla: la cronologia resta e puoi recuperare gli elementi.",
  "Use Restore to bring something back. Approvals given earlier don't come back with it.":
    "Usa Ripristina per recuperare qualcosa. Le approvazioni date in precedenza non tornano insieme.",
  "Connect an agent": "Collega un agente",
  "What does connecting an agent do?": "Cosa fa il collegamento di un agente?",
  "Links your agent platform to Crew with one address. Agents can't use Crew until this is done.":
    "Collega la tua piattaforma di agenti a Crew con un indirizzo. Finché non lo fai, gli agenti non possono usare Crew.",
  "Sets up your coding agent on this computer with a small installed skill. Agents can't use Crew until this is done.":
    "Configura il tuo agente di coding su questo computer con una piccola skill installata. Finché non lo fai, gli agenti non possono usare Crew.",
  "Shows how agents reach this Crew. Agents can't use Crew until they are connected.":
    "Mostra come gli agenti raggiungono questo Crew. Gli agenti non possono usare Crew finché non sono collegati.",
  "Add the address to your platform, approve the connection, then give each agent its brief.":
    "Aggiungi l'indirizzo alla tua piattaforma, approva la connessione, poi dai a ogni agente il suo brief.",
  "Run the command on this page once in your Crew folder, then give each agent its brief.":
    "Esegui una volta il comando di questa pagina nella cartella di Crew, poi dai a ogni agente il suo brief.",
  "Follow the steps on this page once they have loaded.":
    "Segui i passaggi di questa pagina quando sono stati caricati.",
  Search: "Cerca",
  "How does search work?": "Come funziona la ricerca?",
  "Finds tasks and notes by the words in their titles, descriptions, drafts and note text, and agents and buckets by name. Every word must match; the last word also matches longer words that start with it.":
    "Trova attività e note in base alle parole di titoli, descrizioni, bozze e testo delle note, e agenti e bucket per nome. Ogni parola deve corrispondere; l'ultima corrisponde anche a parole più lunghe che iniziano così.",
  "Type in the search box at the top of any page, or press / or Ctrl+K (⌘K on a Mac). Use the arrow keys and Enter to open a result, or See all results for the full list. Archived items appear only when you turn on Include archived.":
    "Scrivi nella casella di ricerca in cima a ogni pagina, oppure premi / o Ctrl+K (⌘K su Mac). Usa le frecce e Invio per aprire un risultato, oppure Vedi tutti i risultati per l'elenco completo. Gli elementi archiviati compaiono solo se attivi Includi archiviati.",
  "Get started": "Per iniziare",
  "What is Get started?": "Cos'è Inizia?",
  "Four steps that take you from an empty Crew to your first reviewed draft.":
    "Quattro passaggi che ti portano da un Crew vuoto alla tua prima bozza approvata.",
  "Do the current step. Don't show this again hides this list.":
    "Completa il passaggio attuale. Non mostrare più nasconde questo elenco.",
  "Needs you": "Tocca a te",
  "What goes under Needs you?": "Cosa c'è in Serve a te?",
  "How many drafts wait for your approval and how many open tasks are on hold, then the items that can't move without you: drafts waiting for approval, tasks stopped by the handoff limit and tasks whose assigned agent is unavailable.":
    "Quante bozze aspettano la tua approvazione e quante attività aperte sono in pausa, poi gli elementi che non vanno avanti senza di te: bozze in attesa di approvazione, attività fermate dal limite di passaggi e attività il cui agente assegnato non è disponibile.",
  "Tap a count to open those items, or open an item to decide on it or fix it.":
    "Tocca un numero per aprire quegli elementi, oppure apri un elemento per decidere o sistemarlo.",
  "To do": "Da fare",
  "What does To do mean?": "Cosa significa Da fare?",
  "Work that hasn't started yet.": "Lavoro non ancora iniziato.",
  "Assign it to an agent and set it to Ready when it can begin.":
    "Assegnala a un agente e impostala su Pronta quando può iniziare.",
  "In progress": "In corso",
  "What does In progress mean?": "Cosa significa In corso?",
  "Work that has started. A task also comes back here after you decide on its draft, whatever you decided.":
    "Lavoro iniziato. Un'attività torna qui anche dopo che hai deciso sulla sua bozza, qualunque sia la decisione.",
  "Open a task and use its Comments tab for the conversation and Activity for the full history. After an approval, do any step outside Crew yourself.":
    "Apri un'attività e usa la scheda Commenti per la conversazione e Attività recenti per la cronologia completa. Dopo un'approvazione, i passaggi fuori da Crew li fai tu.",
  "Needs review": "In revisione",
  "What does Needs review mean?": "Cosa significa In revisione?",
  "A draft was sent for your approval. A task only gets here that way: you can't pick this status by hand.":
    "Una bozza è stata inviata per la tua approvazione. Un'attività arriva qui solo così: non puoi scegliere questo stato a mano.",
  "Open Approvals and decide on the draft.":
    "Apri Approvazioni e decidi sulla bozza.",
  Done: "Fatto",
  "What does Done mean?": "Cosa significa Fatto?",
  "Finished work, plus tasks set to Won't do, most recently changed first; the last 7 days show unless you pick a label or Show older. Approval doesn't put a task here: you or an agent marks it Done. A coding session that you approve in the terminal adds a release label (for example release-0.23.0) and records \"Approved in session\".":
    "Lavoro concluso, più le attività impostate su Non si farà, dalle modificate più di recente; si vedono gli ultimi 7 giorni, a meno che tu non scelga un'etichetta o Mostra precedenti. L'approvazione non porta qui un'attività: sei tu o un agente a segnarla come Fatto. Una sessione di coding che approvi nel terminale aggiunge un'etichetta di release (per esempio release-0.23.0) e registra \"Approvata in sessione\".",
  "Set the status to Done once everything is finished, including anything outside Crew, or Won't do when you decide against it. Tasks from the last 7 days show first; Show older reveals the rest.":
    "Imposta lo stato su Fatto quando tutto è concluso, anche fuori da Crew, oppure su Non si farà se decidi di non farla. Le attività degli ultimi 7 giorni compaiono per prime; Mostra precedenti mostra le altre.",
  Status: "Stato",
  "What do the statuses mean?": "Cosa significano gli stati?",
  "To do: not started. In progress: being worked on. Needs review: a saved draft is waiting for your decision in Approvals. Done: finished. Won't do: decided against.":
    "Da fare: non iniziata. In corso: in lavorazione. In revisione: una bozza salvata aspetta la tua decisione in Approvazioni. Fatto: conclusa. Non si farà: si è deciso di non farla.",
  "Pick any status except Needs review: Crew sets that one itself when you or an agent requests approval for the saved draft, so there is always a snapshot to decide on. Your decision, withdrawing the request or editing the draft moves the task back to In progress.":
    "Scegli qualsiasi stato tranne In revisione: lo imposta Crew quando tu o un agente richiedete l'approvazione della bozza salvata, così c'è sempre un'istantanea su cui decidere. La tua decisione, il ritiro della richiesta o la modifica della bozza riportano l'attività In corso.",
  "Hold (On hold or Ready)": "Disponibilità (In pausa o Pronta)",
  "What do On hold and Ready mean?": "Cosa significano In pausa e Pronta?",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned bot may act, and Crew can wake it if automatic wake-ups are on. Crew puts a task on hold by itself when its draft is edited, its review is withdrawn or the handoff limit is reached, and says why.":
    "Indica se un'attività può iniziare. In pausa è il valore predefinito: nessuno viene risvegliato e decide una persona. Pronta significa che il bot assegnato può agire, e Crew può risvegliarlo se i risvegli automatici sono attivi. Crew mette in pausa un'attività da solo quando la bozza viene modificata, l'approvazione viene ritirata o si raggiunge il limite di passaggi, e dice perché.",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act; your agent sees this when you start it.":
    "Indica se un'attività può iniziare. In pausa è il valore predefinito: nessuno viene risvegliato e decide una persona. Pronta significa che l'agente assegnato può agire; il tuo agente lo vede quando lo avvii.",
  "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act.":
    "Indica se un'attività può iniziare. In pausa è il valore predefinito: nessuno viene risvegliato e decide una persona. Pronta significa che l'agente assegnato può agire.",
  "Set Ready when the work can start. Assigning an agent doesn't do this for you, and a pending approval still blocks work. Putting a task on hold always works and stops any run in progress.":
    "Imposta Pronta quando il lavoro può iniziare. Assegnare un agente non lo fa al posto tuo, e un'approvazione in sospeso blocca ancora il lavoro. Mettere in pausa un'attività funziona sempre e ferma qualsiasi esecuzione in corso.",
  "Assigned agent": "Agente assegnato",
  "What is the assigned agent?": "Cos'è l'agente assegnato?",
  "The agent meant to do this task. Agent names are reported attribution, not verified identities.":
    "L'agente che deve svolgere questa attività. I nomi degli agenti sono attribuzioni dichiarate, non identità verificate.",
  "Pick an agent or leave it Unassigned. Assigning alone doesn't take a task off hold.":
    "Scegli un agente o lascia Non assegnata. La sola assegnazione non toglie un'attività dalla pausa.",
  "Handoff limit": "Limite di passaggi",
  "What is the handoff limit?": "Cos'è il limite di passaggi?",
  "How many times in a row agents can reassign a task before Crew stops it. A stopped task goes on hold and no agent is woken.":
    "Quante volte di seguito gli agenti possono riassegnare un'attività prima che Crew la fermi. Un'attività fermata va in pausa e nessun agente viene risvegliato.",
  "The default is 4 and you can set 1 to 20. Any edit or comment from you resets the count. An agent may set a stopped task Ready if you ask, but that keeps the count, so the next agent reassignment stops it again.":
    "Il valore predefinito è 4 e puoi impostare da 1 a 20. Ogni tua modifica o commento azzera il conteggio. Un agente può impostare su Pronta un'attività fermata se glielo chiedi, ma il conteggio resta, quindi la successiva riassegnazione da parte di un agente la ferma di nuovo.",
  Bucket: "Bucket",
  "What is a bucket?": "Cos'è un bucket?",
  "A named group of notes about one area of work, with an agent responsible for it.":
    "Un gruppo di note con un nome su un'area di lavoro, con un agente responsabile.",
  "Make one for each area of work. Responsibility is a convention, not a permission: every connected agent can still read and write all buckets.":
    "Creane uno per ogni area di lavoro. La responsabilità è una convenzione, non un permesso: ogni agente collegato può comunque leggere e scrivere in tutti i bucket.",
  "Responsible agent": "Agente responsabile",
  "What is the responsible agent?": "Cos'è l'agente responsabile?",
  "The agent expected to look after this bucket's notes.":
    "L'agente che deve occuparsi delle note di questo bucket.",
  "Pick one agent or leave it empty. Other agents are asked to request changes through tasks, but Crew doesn't enforce that.":
    "Scegli un agente o lascia vuoto. Agli altri agenti si chiede di richiedere modifiche tramite attività, ma Crew non lo impone.",
  Note: "Nota",
  "What is a note?": "Cos'è una nota?",
  "A page of Markdown in one bucket, such as a decision, a preference or a finding. Every saved change becomes a new revision.":
    "Una pagina Markdown in un bucket, come una decisione, una preferenza o una scoperta. Ogni modifica salvata diventa una nuova revisione.",
  "Keep what's worth remembering. Use History to see earlier versions; restoring one adds a new revision.":
    "Conserva ciò che vale la pena ricordare. Usa Cronologia per vedere le versioni precedenti; ripristinarne una aggiunge una nuova revisione.",
  Related: "Collegati",
  "What are related tasks and notes?": "Cosa sono attività e note correlate?",
  "Links from this item to other tasks and notes, so you and your agents can find the background. Items that link here show under Linked from.":
    "Collegamenti da questo elemento ad altre attività e note, così tu e i tuoi agenti trovate il contesto. Gli elementi che rimandano qui compaiono in Collegato da.",
  "Search for a task or note and add it. Linking doesn't change the item you link to, but it shows this item under Linked from.":
    "Cerca un'attività o una nota e aggiungila. Il collegamento non modifica l'elemento collegato, ma mostra questo elemento in Collegato da.",
  Draft: "Bozza",
  "What is a draft?": "Cos'è una bozza?",
  "The text you want approved, kept on the task. You or an agent can write it.":
    "Il testo che vuoi approvare, conservato nell'attività. Puoi scriverlo tu o un agente.",
  "Write it here and save. Changing a draft withdraws any pending approval for it.":
    "Scrivila qui e salva. Modificare una bozza ritira l'eventuale approvazione in sospeso.",
  "Request approval": "Richiedi approvazione",
  "What does Request approval do?": "Cosa fa Richiedi approvazione?",
  "Saves the submitted text and options in Approvals and moves the task to Needs review.":
    "Salva il testo e le opzioni in Approvazioni e sposta l’attività in revisione.",
  "Save a draft or add options for the reviewer. If you change the draft later, request approval again.":
    "Salva una bozza o aggiungi opzioni tra cui scegliere. Se modifichi la bozza in seguito, richiedi di nuovo l’approvazione.",
  "Reason for change": "Motivo della modifica",
  "Why give a reason for change?": "Perché indicare un motivo della modifica?",
  "A short remark kept in this item's history, saying why you changed it.":
    "Una breve nota conservata nella cronologia di questo elemento, che dice perché l'hai modificato.",
  "Optional. Say what changed and why, so you and your agents can follow it later.":
    "Facoltativo. Indica cosa è cambiato e perché, così tu e i tuoi agenti potrete seguirlo in seguito.",
  Brief: "Brief",
  "What is a brief?": "Cos'è un brief?",
  "The instructions for this agent: what it works on, which bucket is its own, when to hand off and what to save.":
    "Le istruzioni per questo agente: su cosa lavora, qual è il suo bucket, quando passare il lavoro e cosa salvare.",
  "Write it here, then paste it into the agent that will use it. Crew doesn't send it there for you.":
    "Scrivilo qui, poi incollalo nell'agente che lo userà. Crew non glielo invia per te.",
  "How an agent is started": "Come viene avviato un agente",
  "How is an agent started?": "Come viene avviato un agente?",
  "Webhook (bot): Crew wakes it over a webhook when a Ready task can be worked on. I start it myself: a project agent, such as one per code repository, whose coding sessions you start in Codex or Claude Code; it has no webhook. Person: someone who does the work by hand.":
    "Webhook (bot): Crew lo risveglia tramite webhook quando si può lavorare su un'attività pronta. Lo avvio io: un agente di progetto, per esempio uno per repository di codice, le cui sessioni di coding avvii in Codex o Claude Code; non ha webhook. Persona: qualcuno che svolge il lavoro a mano.",
  "For a project agent, name it after the project, for example pocketcontext-crew, then use Start a session on its card.":
    "Per un agente di progetto, dagli il nome del progetto, per esempio pocketcontext-crew, poi usa Avvia una sessione sulla sua scheda.",
  Claim: "Presa in carico",
  "What is a claim?": "Cos'è una presa in carico?",
  "A coding session marks the one task it is working on as claimed for 2 hours, renewed while it works, so a second session can't take the same task. The claim names the session for your information; it isn't an identity.":
    "Una sessione di coding segna l'unica attività su cui lavora come presa in carico per 2 ore, rinnovate mentre lavora, così una seconda sessione non può prendere la stessa attività. La presa in carico indica la sessione a titolo informativo; non è un'identità.",
  "Nothing to do while it is live. Claim expired means the session stopped renewing it: release the claim to put the task back in To do.":
    "Finché è attiva non c'è nulla da fare. Presa in carico scaduta significa che la sessione ha smesso di rinnovarla: rilascia la presa in carico per rimettere l'attività in Da fare.",
  MCP: "MCP",
  "What is MCP?": "Cos'è MCP?",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has one MCP address that all your agents share.":
    "Model Context Protocol, un modo comune per collegare le app di IA a strumenti esterni. Questo Crew ha un indirizzo MCP condiviso da tutti i tuoi agenti.",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has no domain, so it has no MCP address.":
    "Model Context Protocol, un modo comune per collegare le app di IA a strumenti esterni. Questo Crew non ha un dominio, quindi non ha un indirizzo MCP.",
  "Model Context Protocol, a common way for AI apps to connect to outside tools. Only Crew installs with a domain offer it.":
    "Model Context Protocol, un modo comune per collegare le app di IA a strumenti esterni. Lo offrono solo le installazioni di Crew con un dominio.",
  "Paste the address wherever your platform asks for an MCP server.":
    "Incolla l'indirizzo ovunque la tua piattaforma chieda un server MCP.",
  "Use the skill on Connect an agent instead.":
    "Usa invece la skill in Collega un agente.",
  "Connect an agent shows what applies to this Crew.":
    "Collega un agente mostra cosa vale per questo Crew.",
  Dispatcher: "Dispatcher",
  "What is the dispatcher?": "Cos'è il dispatcher?",
  "One existing bot that receives Crew's wake-up signals and passes each one to the right bot. It keeps its normal job.":
    "Un bot esistente che riceve i segnali di risveglio di Crew e passa ciascuno al bot giusto. Mantiene il suo compito normale.",
  "Choose the bot, then follow the steps here. Changing it pauses delivery and clears the previous webhook binding.":
    "Scegli il bot, poi segui i passaggi qui. Cambiarlo sospende la consegna e rimuove il collegamento webhook precedente.",
  "Automatic wake-ups": "Risvegli automatici",
  "What are automatic wake-ups?": "Cosa sono i risvegli automatici?",
  "Optional. Crew signals one of your Grok Bots over HTTPS when a Ready task can be worked on, so it doesn't wait for your platform to run it.":
    "Facoltativo. Crew avvisa uno dei tuoi Grok Bot via HTTPS quando si può lavorare su un'attività pronta, così non aspetta che la tua piattaforma lo esegua.",
  "Optional, and meant for cloud bots: Crew signals a Grok Bot over HTTPS when a Ready task can be worked on. Without a domain, a woken cloud bot can't answer.":
    "Facoltativo e pensato per i bot cloud: Crew avvisa un Grok Bot via HTTPS quando si può lavorare su un'attività pronta. Senza un dominio, un bot cloud risvegliato non può rispondere.",
  "Optional. Crew can signal a Grok Bot over HTTPS when a Ready task can be worked on. Connect an agent shows whether this suits your Crew.":
    "Facoltativo. Crew può avvisare un Grok Bot via HTTPS quando si può lavorare su un'attività pronta. Collega un agente mostra se è adatto al tuo Crew.",
  "Follow the steps in order. Enabling delivery doesn't notify existing tasks.":
    "Segui i passaggi in ordine. Attivare la consegna non notifica le attività esistenti.",
  "You can skip this and start your coding agent yourself when there is work.":
    "Puoi saltare questo passaggio e avviare tu il tuo agente di coding quando c'è lavoro.",
  "Follow the steps in order if you want this.":
    "Segui i passaggi in ordine se lo desideri.",
  "Webhook credentials": "Credenziali del webhook",
  "What are webhook credentials?": "Cosa sono le credenziali del webhook?",
  "The URL and secret key of your bot's routine, which let Crew send it wake-up signals.":
    "L'URL e la chiave segreta della routine del tuo bot, che permettono a Crew di inviargli segnali di risveglio.",
  "Copy them from the routine straight into this form, never into chat. They are stored encrypted, never shown again and not available to agents.":
    "Copiale dalla routine direttamente in questo modulo, mai in chat. Sono salvate cifrate, non vengono più mostrate e non sono disponibili per gli agenti.",
  // Attachments, previews and upload API messages
  "The pending approval was withdrawn because the task changed. Send the draft for approval again when it's ready.":
    "L'approvazione in attesa è stata ritirata perché l'attività è cambiata. Richiedi di nuovo l'approvazione della bozza quando è pronta.",
  "Your browser can't play {name}.":
    "Il tuo browser non può riprodurre {name}.",
  "Loading {name}…": "Caricamento di {name}…",
  "[Image: {alt}]": "[Immagine: {alt}]",
  attachment: "file",
  "Image unavailable: {name}": "Immagine non disponibile: {name}",
  "Image removed: {name}": "Immagine rimossa: {name}",
  "Open image: {name}": "Apri immagine: {name}",
  Image: "Immagine",
  "image on {domain}": "immagine su {domain}",
  "image on another site": "immagine su un altro sito",
  image: "immagine",
  "file removed": "file rimosso",
  "file unavailable": "file non disponibile",
  "Could not load files.": "Impossibile caricare i file.",
  "Save first.": "Salva prima.",
  "The file was not attached.": "Il file non è stato allegato.",
  "Could not remove the file.": "Impossibile rimuovere il file.",
  "Could not restore the file.": "Impossibile ripristinare il file.",
  "Could not create an upload link.":
    "Impossibile creare un link di caricamento.",
  "Get a new upload link": "Ottieni un nuovo link di caricamento",
  "Get upload link": "Ottieni link di caricamento",
  "Link copied": "Link copiato",
  "Copy upload link": "Copia link di caricamento",
  "Could not copy automatically; copy it from above.":
    "Copia automatica non riuscita; copialo da sopra.",
  "Manage upload links": "Gestisci link di caricamento",
  "Download {name}": "Scarica {name}",
  Download: "Scarica",
  file: "file",
  FILE: "FILE",
  "Open {name}": "Apri {name}",
  "Remove {name}? It moves to Removed files, where you can restore it.":
    "Rimuovere {name}? Finisce tra i file rimossi, da dove puoi ripristinarlo.",
  Files: "File",
  "{count} of 20": "{count} di 20",
  "Add files": "Aggiungi file",
  "Choose files to add": "Scegli i file da aggiungere",
  "Drop files here or paste a screenshot. Up to 20 MB each.":
    "Trascina qui i file o incolla uno screenshot. Fino a 20 MB ciascuno.",
  "They are saved with the new item.": "Vengono salvati con il nuovo elemento.",
  "Files not added": "File non aggiunti",
  Uploads: "Caricamenti",
  "Retry {name}": "Riprova {name}",
  Retry: "Riprova",
  "Dismiss {name}": "Ignora {name}",
  Dismiss: "Chiudi",
  "Uploading {name}": "Caricamento di {name}",
  "Remove {name}": "Rimuovi {name}",
  Remove: "Rimuovi",
  "Removed files ({n})": "File rimossi ({n})",
  "Restore {name}": "Ripristina {name}",
  Restore: "Ripristina",
  "a file": "un file",
  "via upload link": "tramite link di caricamento",
  "Owner / connection": "Proprietario / connessione",
  "Attached {name}": "{name} allegato",
  "Removed {name}": "{name} rimosso",
  "Restored {name}": "{name} ripristinato",
  "Created an upload link": "Link di caricamento creato",
  "Revoked an upload link": "Link di caricamento revocato",
  "Webhook activity": "Attività webhook",
  "Work activity": "Attività di lavoro",
  Change: "Modifica",
  "Open this link on your phone or another device to add up to {n} file to this note. It works once and expires {when}. It is shown only now.":
    "Apri questo link sul telefono o su un altro dispositivo per aggiungere fino a {n} file a questa nota. Funziona una sola volta e scade {when}. Viene mostrato solo ora.",
  "Open this link on your phone or another device to add up to {n} files to this note. It works once and expires {when}. It is shown only now.":
    "Apri questo link sul telefono o su un altro dispositivo per aggiungere fino a {n} file a questa nota. Funziona una sola volta e scade {when}. Viene mostrato solo ora.",
  "Open this link on your phone or another device to add up to {n} file to this task. It works once and expires {when}. It is shown only now.":
    "Apri questo link sul telefono o su un altro dispositivo per aggiungere fino a {n} file a questa attività. Funziona una sola volta e scade {when}. Viene mostrato solo ora.",
  "Open this link on your phone or another device to add up to {n} files to this task. It works once and expires {when}. It is shown only now.":
    "Apri questo link sul telefono o su un altro dispositivo per aggiungere fino a {n} file a questa attività. Funziona una sola volta e scade {when}. Viene mostrato solo ora.",
  "File: {name}": "File: {name}",
  "Close file preview": "Chiudi anteprima file",
  "File {n} of {count}: {name}": "File {n} di {count}: {name}",
  "No preview for this type of file.":
    "Nessuna anteprima per questo tipo di file.",
  "The preview could not be opened.": "Impossibile aprire l'anteprima.",
  "Opening {name}…": "Apertura di {name}…",
  "Preview width": "Larghezza anteprima",
  Desktop: "Desktop",
  Mobile: "Mobile",
  "Open in new tab": "Apri in una nuova scheda",
  "Preview runs isolated from Crew": "L'anteprima è isolata da Crew",
  "Preview of {name}": "Anteprima di {name}",
  "Too large to preview.": "Troppo grande per l'anteprima.",
  "The file could not be loaded.": "Impossibile caricare il file.",
  "Not valid text: this file is not UTF-8, so it can't be shown here.":
    "Testo non valido: questo file non è UTF-8, quindi non può essere mostrato qui.",
  "Not valid JSON; showing the text as it is.":
    "JSON non valido; il testo viene mostrato così com'è.",
  "Wrap lines": "A capo automatico",
  "The file is empty.": "Il file è vuoto.",
  "Showing first {shown} of {total} rows.": "Prime {shown} righe di {total}.",
  "[Image]": "[Immagine]",
  "Can't play this format here.":
    "Questo formato non può essere riprodotto qui.",
  "This PDF is password protected and can't be shown here.":
    "Questo PDF è protetto da password e non può essere mostrato qui.",
  "This PDF can't be shown here.": "Questo PDF non può essere mostrato qui.",
  "Opening the PDF viewer…": "Apertura del visualizzatore PDF…",
  "The PDF viewer could not be loaded.":
    "Impossibile caricare il visualizzatore PDF.",
  "{n} row.": "{n} riga.",
  "{n} rows.": "{n} righe.",
  "{name} is empty.": "{name} è vuoto.",
  "{name} is larger than 20 MB ({size}).": "{name} supera i 20 MB ({size}).",
  "{name} was not added: a task or note holds at most 20 files.":
    "{name} non è stato aggiunto: un'attività o una nota contiene al massimo 20 file.",
  "{name} was not added: files saved with a new item are limited to 89 MB in total. Add it after saving.":
    "{name} non è stato aggiunto: i file salvati con un nuovo elemento sono limitati a 89 MB in totale. Aggiungilo dopo aver salvato.",
  "This file was refused.": "Questo file è stato rifiutato.",
  "Network error: the upload did not finish.":
    "Errore di rete: il caricamento non è stato completato.",
  "Upload cancelled.": "Caricamento annullato.",
  "The upload is too large.": "Il caricamento è troppo grande.",
  "Upload failed (HTTP {status}).": "Caricamento non riuscito (HTTP {status}).",
  "File access is unavailable.": "L'accesso ai file non è disponibile.",
  "The file could not be loaded (HTTP {status}).":
    "Impossibile caricare il file (HTTP {status}).",
  Created: "Creato",
  Updated: "Aggiornato",
  Comment: "Commento",
  Claimed: "Presa in carico",
  "Claim renewed": "Presa in carico rinnovata",
  "Claim released": "Presa in carico rilasciata",
  "Woke the assignee": "Assegnatario risvegliato",
  "Stopped at the handoff limit": "Fermato al limite di passaggi",
  "Started by the assignee": "Avviato dall'assegnatario",
  "Restored an earlier revision": "Ripristinata una revisione precedente",
  "Review requested": "Approvazione richiesta",
  "Review decided": "Approvazione decisa",
  "Review withdrawn": "Approvazione ritirata",
  "Review restored": "Approvazione ripristinata",
  "Responsibility changed": "Responsabilità cambiata",
  "Draft created": "Bozza creata",
  "Draft updated": "Bozza aggiornata",
  Published: "Pubblicato",
  "Published link replaced": "Link pubblicato sostituito",
  "Link revoked": "Link revocato",
  "Link expiry changed": "Scadenza del link modificata",
  Archived: "Archiviato",
  Restored: "Ripristinato",
  "Work started": "Lavoro iniziato",
  "Handed to the bot": "Passato al bot",
  "Handed off": "Passato",
  "Work lease renewed": "Lease di lavoro rinnovato",
  "Work finished": "Lavoro finito",
  "Work cancelled": "Lavoro annullato",
  "Work recovered": "Lavoro recuperato",
  // File viewer, PDF and page previews, file settings and the upload page
  "File {n} of {total}: {name}": "File {n} di {total}: {name}",
  "Image {n} of {total}: {name}": "Immagine {n} di {total}: {name}",
  "Image viewer": "Visualizzatore immagini",
  "Close image viewer": "Chiudi visualizzatore immagini",
  "Open original": "Originale",
  "Open the original in a new tab": "Apri l'originale in una nuova scheda",
  "This page could not be shown.": "Impossibile mostrare questa pagina.",
  "PDF pages": "Pagine PDF",
  "Previous page": "Pagina precedente",
  "Page {page} of {pages}": "Pagina {page} di {pages}",
  "Opening…": "Apertura…",
  "Next page": "Pagina successiva",
  "Zoom out": "Riduci",
  "Zoom in": "Ingrandisci",
  "Fit width": "Larghezza",
  "{name}, page {page}": "{name}, pagina {page}",
  "Page {page} of {name}": "Pagina {page} di {name}",
  Zoom: "Zoom",
  "Zoom level": "Livello di zoom",
  Fit: "Adatta",
  "Fit to screen": "Adatta allo schermo",
  "Actual size": "100%",
  Viewer: "Visualizzatore",
  "Previous file": "File precedente",
  "Previous image": "Immagine precedente",
  "Previous file (←)": "File precedente (←)",
  "Previous image (←)": "Immagine precedente (←)",
  "Next file": "File successivo",
  "Next image": "Immagine successiva",
  "Next file (→)": "File successivo (→)",
  "Next image (→)": "Immagine successiva (→)",
  "Only images open as an original here":
    "Qui si aprono come originale solo le immagini",
  "Enter a size in GB, for example 5 or 0.5.":
    "Inserisci una dimensione in GB, per esempio 5 o 0,5.",
  "The limit is at least 1 MB (0.001 GB).":
    "Il limite è di almeno 1 MB (0,001 GB).",
  "The limit is at most 1 TB (1024 GB).":
    "Il limite è al massimo 1 TB (1024 GB).",
  "This changed elsewhere. Reloaded; check and try again.":
    "È stato modificato altrove. Ricaricato; controlla e riprova.",
  "Could not load file settings. Refresh to try again.":
    "Impossibile caricare le impostazioni dei file. Aggiorna per riprovare.",
  "Storage limit saved.": "Limite di spazio salvato.",
  "Could not save the storage limit.":
    "Impossibile salvare il limite di spazio.",
  "Revoke this upload link for “{title}”? It stops accepting files right away.":
    "Revocare il link di caricamento per “{title}”? Smette subito di accettare file.",
  "Revoke this upload link? It stops accepting files right away.":
    "Revocare questo link di caricamento? Smette subito di accettare file.",
  "Upload link revoked.": "Link di caricamento revocato.",
  "Could not revoke the upload link.":
    "Impossibile revocare il link di caricamento.",
  "A note": "Una nota",
  "A task": "Un'attività",
  "created ": "creato ",
  "expires ": "scade ",
  "expired ": "scaduto ",
  "{added}/{max} files": "{added}/{max} file",
  "Revoke upload link for {title}": "Revoca il link di caricamento per {title}",
  note: "nota",
  task: "attività",
  Revoke: "Revoca",
  Storage: "Spazio",
  "{used} of {max} used": "{used} di {max} usati",
  "Storage used": "Spazio usato",
  "{used} of {max}": "{used} di {max}",
  "Storage limit (GB)": "Limite di spazio (GB)",
  "Save limit": "Salva limite",
  "From 1 MB to 1 TB. Archived files count too: Crew never deletes files. A limit below what is used deletes nothing; new files are refused until you raise it.":
    "Da 1 MB a 1 TB. Contano anche i file archiviati: Crew non elimina mai i file. Un limite inferiore allo spazio usato non elimina nulla; i nuovi file vengono rifiutati finché non lo alzi.",
  "Upload links": "Link di caricamento",
  "Create a link from a task or note. Each link works once and is shown only when it is created.":
    "Crea un link da un'attività o da una nota. Ogni link funziona una sola volta e viene mostrato solo quando lo crei.",
  "Active upload links": "Link di caricamento attivi",
  "No active upload links.": "Nessun link di caricamento attivo.",
  "Recent used, expired or revoked links ({n})":
    "Link recenti usati, scaduti o revocati ({n})",
  "Recent upload links": "Link di caricamento recenti",
  Active: "Attivo",
  Used: "Usato",
  Expired: "Scaduto",
  Revoked: "Revocato",
  "Too many upload requests right now.":
    "Troppe richieste di caricamento in questo momento.",
  "Could not open this upload link. Check your connection and try again.":
    "Impossibile aprire questo link di caricamento. Controlla la connessione e riprova.",
  "Empty file": "File vuoto",
  "Larger than {size}": "Più grande di {size}",
  "This link takes at most {max}. Remove {over}.":
    "Questo link accetta al massimo {max}. Rimuovi {over}.",
  "Remove the files marked below before sending.":
    "Rimuovi i file segnati qui sotto prima di inviare.",
  "All files together must be at most {size}. Remove some files to send fewer at once.":
    "Tutti i file insieme non possono superare {size}. Rimuovine alcuni per inviarne meno alla volta.",
  "Network error: the files may not have arrived. Check your connection and send again.":
    "Errore di rete: i file potrebbero non essere arrivati. Controlla la connessione e invia di nuovo.",
  "Another upload is in progress right now.":
    "C'è già un altro caricamento in corso.",
  "These files are too large to send together. Remove some.":
    "Questi file sono troppo grandi per inviarli insieme. Rimuovine alcuni.",
  "No file was added. Fix or remove the files below and send again.":
    "Nessun file aggiunto. Correggi o rimuovi i file qui sotto e invia di nuovo.",
  "The upload failed (HTTP {status}).":
    "Caricamento non riuscito (HTTP {status}).",
  "Opening the upload link…": "Apertura del link di caricamento…",
  "Add screenshots": "Aggiungi screenshot",
  "Try again in {n} seconds.": "Riprova tra {n} secondi.",
  "Try again": "Riprova",
  "Upload link unavailable": "Link di caricamento non disponibile",
  "This link has expired or was already used. Ask for a new one.":
    "Questo link è scaduto o è già stato usato. Chiedine uno nuovo.",
  "If your earlier send finished before the connection dropped, its files were added. Ask the person who shared the link to check.":
    "Se l'invio precedente è terminato prima che la connessione cadesse, i file sono stati aggiunti. Chiedi a chi ha condiviso il link di controllare.",
  "Partly done": "Fatto in parte",
  "{files} added to the note {title}.": "{files} aggiunti alla nota {title}.",
  "{files} added to the task {title}.":
    "{files} aggiunti all'attività {title}.",
  "Upload results": "Risultati del caricamento",
  Saved: "Salvato",
  "Not added": "Non aggiunto",
  "This link is now used. You can close this page.":
    "Questo link è stato usato. Puoi chiudere questa pagina.",
  "Add screenshots to:": "Aggiungi screenshot a:",
  "Up to {files}, {each} each, {total} in total. Any file type.":
    "Fino a {files}, {each} ciascuno, {total} in totale. Qualsiasi tipo di file.",
  "Choose photos or files": "Scegli foto o file",
  "You can also paste or drag files here.":
    "Puoi anche incollare o trascinare qui i file.",
  "Files to send": "File da inviare",
  "{files}, {size}": "{files}, {size}",
  "Upload progress": "Avanzamento del caricamento",
  "Sending {percent}%": "Invio {percent}%",
  "Sending…": "Invio…",
  "Send {files}": "Invia {files}",
  Send: "Invia",
  "The link works for one send. Files are added to this note only; nothing else in Crew is visible here.":
    "Il link vale per un solo invio. I file vengono aggiunti solo a questa nota; qui non è visibile nient'altro di Crew.",
  "The link works for one send. Files are added to this task only; nothing else in Crew is visible here.":
    "Il link vale per un solo invio. I file vengono aggiunti solo a questa attività; qui non è visibile nient'altro di Crew.",
  "{n} file": "{n} file",
  "{n} files": "{n} file",
  "Copy link": "Copia link",
  "Open in Safari": "Apri in Safari",
  "Open in browser": "Apri nel browser",
  Share: "Condividi",
  "Shared page: {title}": "Pagina condivisa: {title}",
  Back: "Indietro",
  "Could not copy automatically: {url}": "Copia automatica non riuscita: {url}",
  "This page can only open outside Crew.":
    "Questa pagina si apre solo fuori da Crew.",
};

export default it;
