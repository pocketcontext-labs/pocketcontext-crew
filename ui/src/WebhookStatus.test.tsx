import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebhookStatus from "./WebhookStatus";
import { crewApi, type Row } from "./crewApi";
const agents: Row[] = [
  { id: "build", revision: 1, name: "Build" },
  { id: "learn", revision: 1, name: "Learn" },
];
let config: Row;
let fixtures: Record<string, Row[]>;
beforeEach(() => {
  config = {
    id: "integration",
    revision: 4,
    scope: "global",
    agent: "build",
    enabled: false,
    instructions: "Read the current task, then route it.",
    instruction_revision: 2,
    applied_revision: 2,
    sync_status: "reported",
    secret_configured: true,
    url_configured: true,
    receiver_host: "hooks.example",
    subscriptions: ["created", "ready"],
  };
  fixtures = {
    webhook_configs: [config],
    webhook_mappings: [
      { id: "mapping", revision: 2, agent: "build", bot_ref: "Build bot" },
    ],
    webhook_deliveries: [],
    webhook_executions: [],
  };
  vi.spyOn(crewApi, "read").mockImplementation(async (c) => fixtures[c] || []);
  vi.spyOn(crewApi, "write").mockResolvedValue(config);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function open() {
  render(<WebhookStatus agents={agents} />);
  await screen.findByRole("textbox", { name: "Routine instructions" });
}
it("saves manually entered credentials without enabling or testing and clears both fields", async () => {
  await open();
  const url = screen.getByLabelText("Replacement webhook URL");
  const secret = screen.getByLabelText("Replacement secret");
  expect(url).toHaveValue("");
  expect(secret).toHaveValue("");
  expect(secret).toHaveAttribute("type", "password");
  fireEvent.change(url, { target: { value: "https://new.example/private" } });
  expect(
    screen.getByRole("button", { name: "Save credentials" }),
  ).toBeDisabled();
  fireEvent.change(secret, { target: { value: "synthetic-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.credentials.update",
      { url: "https://new.example/private", secret: "synthetic-secret" },
      config,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  await waitFor(() => expect(secret).toHaveValue(""));
  expect(url).toHaveValue("");
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});
it("preserves a retry key after a lost response and never renders raw errors", async () => {
  vi.mocked(crewApi.write).mockRejectedValue({
    status: 503,
    message: "private-token private-url",
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  await waitFor(() => expect(crewApi.write).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(crewApi.write).mock.calls;
  expect(calls[0][4]?.idempotency_key).toBe(calls[1][4]?.idempotency_key);
  expect(document.body).not.toHaveTextContent("private-token");
  expect(document.body).not.toHaveTextContent("private-url");
});
it("selects one dispatcher via global configuration without updating credentials", async () => {
  await open();
  expect(
    screen.getByRole("checkbox", { name: "Use Build as Crew dispatcher" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Use Learn as Crew dispatcher" }),
  ).not.toBeChecked();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Use Learn as Crew dispatcher" }),
  );
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.integration.update",
      { agent: "learn" },
      config,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});
it("creates a recipient mapping with an explicit zero revision", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("Grok Bot reference for Learn"), {
    target: { value: "Learn bot" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Learn mapping" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.mapping.update",
      { agent: "learn", bot_ref: "Learn bot" },
      undefined,
      "",
      { idempotency_key: expect.any(String), expected_revision: 0 },
    ),
  );
});
it("blocks enable and tests when instruction changes have not been applied", async () => {
  config.applied_revision = 1;
  await open();
  expect(screen.getByText(/Update needed/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Enable delivery" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
});
it("distinguishes reported instruction sync from verified and delivery from execution", async () => {
  fixtures.webhook_deliveries = [
    {
      id: "delivery",
      revision: 1,
      state: "accepted",
      attempts: 1,
      task: "task",
    },
  ];
  fixtures.webhook_executions = [
    { id: "execution", revision: 1, delivery: "delivery", state: "running" },
  ];
  await open();
  expect(screen.getByText(/Applied — verification needed/)).toBeInTheDocument();
  expect(screen.getByText("Accepted by receiver")).toBeInTheDocument();
  expect(screen.getByText("Execution started")).toBeInTheDocument();
  expect(screen.queryByText("Completed")).not.toBeInTheDocument();
});
it("reports revision conflicts without retrying or overwriting automatically", async () => {
  vi.mocked(crewApi.write).mockRejectedValue({ status: 409 });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Enable delivery" }));
  await screen.findByText(/configuration changed elsewhere/);
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});
it("requires outcome review before recovery and does not resend a webhook", async () => {
  const execution: Row = {
    id: "execution",
    revision: 3,
    delivery: "delivery",
    task: "task",
    state: "handed_off",
  };
  fixtures.webhook_executions = [execution];
  await open();
  fireEvent.change(screen.getByLabelText("Execution to recover"), {
    target: { value: execution.id },
  });
  expect(
    screen.getByRole("button", { name: "Authorize retry" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the uncertain outcome and any external actions.",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Authorize retry" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "execution.recover",
      { resolution: "retry" },
      execution,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
  await screen.findByText(/Retry authorized. Ask the intended recipient/);
});
it("shows unmapped agents and does not offer recovery for active or terminal work", async () => {
  fixtures.webhook_executions = [
    {
      id: "running",
      revision: 1,
      state: "running",
      lease_until: "2999-01-01T00:00:00Z",
    },
    { id: "completed", revision: 1, state: "completed" },
  ];
  await open();
  expect(
    screen.getByText(
      "No Grok Bot mapping. Ready tasks for this agent cannot be routed.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Execution to recover"),
  ).not.toBeInTheDocument();
});
it("distinguishes prepared handoff from reported sent handoff", async () => {
  fixtures.webhook_deliveries = [
    {
      id: "delivery",
      revision: 1,
      state: "accepted",
      task: "task",
      attempts: 1,
    },
  ];
  fixtures.webhook_executions = [
    {
      id: "execution",
      revision: 1,
      delivery: "delivery",
      state: "handed_off",
      handoff_at: "2026-11-07T00:00:00Z",
    },
  ];
  await open();
  expect(screen.getByText("Handoff reported")).toBeInTheDocument();
});
