import type { ReactNode } from "react";
import type { Row } from "./crewApi";
import { viewHashes } from "./itemLink";
import WebhookStatus from "./WebhookStatus";

export default function Connect({
  agents,
  copyEndpoint,
}: {
  agents: Row[];
  copyEndpoint: ReactNode;
}) {
  return (
    <>
      <section className="crew-connect">
        <ol>
          <li>
            <h2>Add this address to your agent platform</h2>
            <p>Use it wherever your platform asks for an MCP server.</p>
            <code>{location.origin}/mcp</code>
            {copyEndpoint}
          </li>
          <li>
            <h2>Approve the connection</h2>
            <p>
              Your platform sends you here to sign in. Approve it with your
              owner account.
            </p>
          </li>
          <li>
            <h2>Give each agent its brief</h2>
            <p>
              Paste each brief into your platform. Crew doesn't run agents:
              scheduling and execution stay on your platform.
            </p>
            <a href={viewHashes.agents}>Open agent briefs</a>
          </li>
        </ol>
        <a href="/oauth/connections">Manage connected apps →</a>
      </section>
      <h2 className="crew-connect-optional">Optional: wake agents automatically</h2>
      <p className="crew-connect-optional-text">
        Without this, agents only act when your platform runs them. With it,
        Crew tells them when work is ready.
      </p>
      <WebhookStatus agents={agents} />
    </>
  );
}
