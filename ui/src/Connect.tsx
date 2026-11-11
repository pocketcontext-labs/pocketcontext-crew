import { useEffect, useState, type ReactNode } from "react";
import {
  crewApi,
  type ConnectedApp,
  type ConnectionState,
  type Row,
} from "./crewApi";
import FileSettings from "./FileSettings";
import Help from "./Help";
import { viewHashes } from "./itemLink";
import WebhookStatus from "./WebhookStatus";

export const skillCommand = "./pocketcontext-crew skill";

export function ConnectionPending({
  connection,
}: {
  connection: ConnectionState;
}) {
  if (connection.kind === "checking")
    return <p role="status">Checking how this Crew is set up…</p>;
  if (connection.kind === "unknown")
    return (
      <p role="alert">
        Could not check how this Crew is set up. Refresh to try again.
      </p>
    );
  return null;
}

function BriefLink() {
  return <a href={viewHashes.agents}>Open agent briefs</a>;
}

function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () =>
    crewApi
      .connectedApps()
      .then((list) => {
        setApps(list);
        setError("");
      })
      .catch(() => setError("Could not load connected apps. Refresh to try again."));
  useEffect(() => {
    void load();
  }, []);
  const revoke = async (app: ConnectedApp) => {
    if (!window.confirm(`Disconnect ${app.name}? It loses access right away.`))
      return;
    setBusy(app.id);
    try {
      await crewApi.revokeConnectedApp(app.id);
      await load();
    } catch {
      setError(`Could not disconnect ${app.name}. Try again.`);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="crew-connected-apps" aria-label="Connected apps">
      <h2>Connected apps</h2>
      <p>
        These apps can read and change notes and tasks, and request your
        review. They decide a review only when you ask them to in the
        conversation.
      </p>
      {error && <p role="alert">{error}</p>}
      {apps && !apps.length && !error && <p>No apps connected yet.</p>}
      <ul>
        {apps?.map((app) => (
          <li key={app.id}>
            <div>
              <strong>{app.name}</strong>
              <small>
                Connected {new Date(app.created * 1000).toLocaleDateString()}
              </small>
            </div>
            <button disabled={busy === app.id} onClick={() => void revoke(app)}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RemoteSteps({
  url,
  copyEndpoint,
}: {
  url: string;
  copyEndpoint: ReactNode;
}) {
  return (
    <>
      <ol>
        <li>
          <div className="crew-title-row">
            <h2>Add this address to your agent platform</h2>
            <Help topic="mcp" />
          </div>
          <p>Use it wherever your platform asks for an MCP server.</p>
          <code>{url}</code>
          {copyEndpoint}
        </li>
        <li>
          <h2>Approve the connection</h2>
          <p>
            Your platform sends you here to sign in. Approve it with your owner
            account.
          </p>
        </li>
        <li>
          <h2>Give each agent its brief</h2>
          <p>
            Paste each brief into your platform. Crew doesn't run agents:
            scheduling and execution stay on your platform.
          </p>
          <BriefLink />
        </li>
      </ol>
      <ConnectedApps />
    </>
  );
}

function LocalSteps() {
  return (
    <>
      <ol>
        <li>
          <h2>Install the Crew skill for your coding agent</h2>
          <p>
            Run this once in your Crew folder. It sets up Claude Code, Codex and
            Antigravity on this computer.
          </p>
          <code>{skillCommand}</code>
          <p>On Windows, the program is pocketcontext-crew.exe.</p>
        </li>
        <li>
          <h2>Ask your agent to use Crew</h2>
          <p>
            There is no address to add. Your agent uses Crew with your owner
            access. It decides a review only when you ask it to in the
            conversation.
          </p>
        </li>
        <li>
          <h2>Give each agent its brief</h2>
          <p>
            Paste each brief into your coding agent. Crew doesn't run agents:
            you start them yourself.
          </p>
          <BriefLink />
        </li>
      </ol>
      <details>
        <summary>Use Crew from another computer</summary>
        <p>
          On the computer with Crew, keep the first command running. Run the
          second, then paste what it prints into the agent on the other
          computer.
        </p>
        <code>./pocketcontext-crew tunnel serve</code>
        <code>./pocketcontext-crew tunnel invite</code>
      </details>
      <p>
        Cloud assistants such as Grok, ChatGPT or Gemini on the web can't reach
        Crew without a domain.
      </p>
    </>
  );
}

export default function Connect({
  agents,
  tasks,
  notes = [],
  connection,
  copyEndpoint,
}: {
  agents: Row[];
  tasks: Row[];
  notes?: Row[];
  connection: ConnectionState;
  copyEndpoint: ReactNode;
}) {
  const local = connection.kind === "local";
  return (
    <>
      <section className="crew-connect">
        <ConnectionPending connection={connection} />
        {connection.kind === "mcp" && (
          <RemoteSteps url={connection.url} copyEndpoint={copyEndpoint} />
        )}
        {local && <LocalSteps />}
      </section>
      <div className="crew-title-row crew-connect-optional">
        <h2>Optional: wake agents automatically</h2>
        <Help topic="wake-ups" />
      </div>
      <p className="crew-connect-optional-text">
        {local
          ? "Wake-ups are meant for cloud bots. Without a domain, a woken cloud bot can't answer."
          : "Without this, agents only act when your platform runs them. With it, Crew tells them when work is ready."}
      </p>
      <WebhookStatus
        agents={agents}
        tasks={tasks}
        collapsible
        mcpUrl={connection.kind === "mcp" ? connection.url : null}
      />
      <FileSettings tasks={tasks} notes={notes} />
    </>
  );
}
