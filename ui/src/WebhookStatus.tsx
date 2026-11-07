import { useEffect, useState } from "react";
import { crewApi, list, val, type Row } from "./crewApi";

// Only render the public status fields, never a serialized config or payload.
function receiverHost(config: Row) {
  try {
    return new URL(val(config, "url")).hostname;
  } catch {
    return "Unavailable receiver";
  }
}
const deliveryStates: Record<string, string> = {
  pending: "Queued",
  in_flight: "Sending",
  accepted: "Accepted by receiver",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default function WebhookStatus({ agents }: { agents: Row[] }) {
  const [configs, setConfigs] = useState<Row[]>([]);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      crewApi.read("webhook_configs"),
      crewApi.read("webhook_deliveries"),
    ])
      .then(([configRows, deliveryRows]) => {
        if (!alive) return;
        setConfigs(configRows);
        setDeliveries(deliveryRows);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);

  return (
    <section className="crew-webhooks" aria-label="Agent webhooks">
      <div className="crew-section-title">
        <h2>Agent webhooks</h2>
        <button disabled={loading} onClick={() => setRefresh((x) => x + 1)}>
          Refresh webhook status
        </button>
      </div>
      <p>
        Ask your connected assistant to connect an agent to its supported
        receiver. Configuration and delivery controls are available through MCP.
      </p>
      {loading && <p role="status">Loading webhook status…</p>}
      {error && (
        <p role="alert">Could not load webhook status. Refresh to try again.</p>
      )}
      {!loading && !error && (
        <>
          {!configs.length && <p>No agent webhooks configured.</p>}
          {configs.map((config) => {
            const agent = agents.find((row) => row.id === val(config, "agent"));
            const recent = deliveries
              .filter((row) => val(row, "config") === config.id)
              .sort((a, b) =>
                val(b, "created").localeCompare(val(a, "created")),
              );
            return (
              <article className="crew-webhook-card" key={config.id}>
                <h3>{val(agent, "name") || "Unavailable agent"}</h3>
                <p>
                  <strong>{config.enabled ? "Enabled" : "Disabled"}</strong> ·{" "}
                  {receiverHost(config)}
                </p>
                {(!agent || agent.archived) && (
                  <p className="crew-assignment-warning">
                    Agent is inactive or unavailable.
                  </p>
                )}
                <p>
                  Credential:{" "}
                  {config.secret_configured ? "configured" : "not configured"}
                </p>
                <p>
                  Subscriptions:{" "}
                  {list(config, "subscriptions").join(", ") || "None"}
                </p>
                {!recent.length ? (
                  <p>No deliveries recorded.</p>
                ) : (
                  <details>
                    <summary>Delivery history ({recent.length})</summary>
                    <ul>
                      {recent.map((delivery) => (
                        <li key={delivery.id}>
                          <strong>
                            {deliveryStates[val(delivery, "state")] ||
                              "Unknown status"}
                          </strong>
                          {" · "}
                          {val(delivery, "task") ? "Task wake" : "Test event"}
                          {" · "}
                          {Number(delivery.attempts) || 0} attempts
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
          <p className="crew-footnote">
            Receiver acceptance does not mean the task started or completed.
            Human review decisions remain separate.
          </p>
        </>
      )}
    </section>
  );
}
