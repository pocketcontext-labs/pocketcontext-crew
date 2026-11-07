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
    setup: {
      can_test: true,
      can_enable: true,
      blockers: [],
      test_blockers: [],
      test_acknowledged: true,
      runtime_reported: true,
    },
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
  // The first data render can precede the loading promise's finally callback.
  // fireEvent can edit disabled controls, unlike a user; wait for the form to
  // become interactive before typing into mount-initialized mapping fields.
  const selector = await screen.findByRole("combobox", {
    name: "Crew dispatcher",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  fireEvent.click(screen.getByText("Advanced settings and recovery"));
  const credentialDetails = screen.getByText("Replace saved credentials");
  fireEvent.click(credentialDetails);
  const recovery = screen.queryByText("Recover interrupted work");
  if (recovery) fireEvent.click(recovery);
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
  expect(screen.getByRole("combobox", { name: "Crew dispatcher" })).toHaveValue(
    "build",
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Crew dispatcher" }), {
    target: { value: "learn" },
  });
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
  const reference = screen.getByLabelText("Grok Bot reference for Learn");
  const save = screen.getByRole("button", { name: "Save Learn mapping" });
  expect(reference).toBeEnabled();
  fireEvent.change(reference, { target: { value: "Learn bot" } });
  expect(reference).toHaveValue("Learn bot");
  expect(save).toBeEnabled();
  fireEvent.click(save);
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
  delete config.setup;
  await open();
  expect(
    screen.getAllByText(/Instructions not applied/)[0],
  ).toBeInTheDocument();
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
  expect(screen.getAllByText(/Application reported/)[0]).toBeInTheDocument();
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
    screen.getByRole("button", { name: "Authorize another attempt" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the uncertain outcome and any external actions.",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Authorize another attempt" }),
  );
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
  expect(screen.getByText(/Not mapped/)).toBeInTheDocument();
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

it("shows server blockers beside safe test and enable without sending anything", async () => {
  config.setup = {
    can_test: false,
    can_enable: false,
    test_acknowledged: false,
    test_blockers: [
      { code: "sync", message: "Apply the current managed block." },
    ],
    blockers: [
      {
        code: "runtime",
        message: "The webhook routine has not reported native handoff.",
      },
    ],
  };
  await open();
  expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Enable delivery" }),
  ).toBeDisabled();
  expect(screen.getByText("Apply the current managed block.")).toBeVisible();
  expect(
    screen.getByText("The webhook routine has not reported native handoff."),
  ).toBeVisible();
  expect(crewApi.write).not.toHaveBeenCalled();
});
it("copies one nonsecret setup prompt with current capability discovery", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const prompt = writeText.mock.calls[0][0];
  expect(prompt).toContain("collection capabilities");
  expect(prompt).toContain("data._crew");
  expect(prompt).toContain('"Build"');
  expect(prompt).not.toContain("hooks.example");
  expect(crewApi.write).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Copy routing test prompt" }),
  ).toBeDisabled();
});
it("keeps role and reporting instructions outside the read-only managed block", async () => {
  await open();
  expect(
    screen.getByRole("textbox", { name: "Routine instructions" }),
  ).toHaveAttribute("readonly");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reporting instructions" }),
    { target: { value: "Report task links" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save advanced settings" }),
  );
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.integration.update",
      {
        subscriptions: ["created", "ready"],
        role_instructions: "",
        reporting_instructions: "Report task links",
      },
      config,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
});

it("explains a managed block mismatch instead of claiming a revision conflict", async () => {
  vi.mocked(crewApi.write).mockRejectedValue({
    status: 409,
    response: { data: { reason: { code: "instructions_mismatch" } } },
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Enable delivery" }));
  await screen.findByText(/managed block does not match Crew/);
  expect(
    screen.queryByText(/configuration changed elsewhere/),
  ).not.toBeInTheDocument();
});

it("switches dispatch path without exposing or replacing credentials", async () => {
  await open();
  fireEvent.change(screen.getByRole("combobox", { name: "Dispatch path" }), {
    target: { value: "parent_bridge" },
  });
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.integration.update",
      { dispatch_mode: "parent_bridge" },
      config,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});

it("sends an explicit parent bridge test to a mapped teammate while delivery is disabled", async () => {
  config.dispatch_mode = "parent_bridge";
  fixtures.webhook_mappings.push({
    id: "learn-mapping",
    revision: 1,
    agent: "learn",
    bot_ref: "native-learn",
  });
  await open();
  expect(screen.getByRole("combobox", { name: "Test recipient" })).toHaveValue(
    "learn",
  );
  expect(
    screen.getByText(/explicitly sends a diagnostic message/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.test",
      { recipient_agent_id: "learn" },
      config,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});

it("keeps parent receipt separate from recipient acknowledgment and shows its blocker", async () => {
  config.dispatch_mode = "parent_bridge";
  config.setup = {
    can_test: true,
    can_enable: false,
    test_acknowledged: true,
    runtime_reported: true,
    parent_wake_reported: true,
    parent_received: true,
    recipient_acknowledged: false,
    bridge_test_recipient_agent_id: "learn",
    test_event_id: "test-event",
    bridge_test_overdue: true,
    blockers: [
      {
        code: "recipient_ack_missing",
        message: "Wait for the recipient acknowledgment.",
      },
    ],
  };
  fixtures.webhook_deliveries = [
    {
      id: "delivery",
      revision: 1,
      event_id: "test-event",
      state: "accepted",
      attempts: 1,
    },
  ];
  await open();
  expect(screen.getByText("Webhook: Accepted by receiver")).toBeVisible();
  expect(
    screen.getByText("Parent conversation: receipt recorded"),
  ).toBeVisible();
  expect(screen.getByText("Recipient: awaiting acknowledgment")).toBeVisible();
  expect(screen.getByText("Latest test recipient: Learn")).toBeVisible();
  expect(screen.getByText(/Test acknowledgment overdue/)).toBeVisible();
  expect(
    screen.getByText("Wait for the recipient acknowledgment."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Enable delivery" }),
  ).toBeDisabled();
  expect(crewApi.write).not.toHaveBeenCalled();
});

it("copies parent bridge setup and direct owner authorization separately without sending", async () => {
  config.dispatch_mode = "parent_bridge";
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain("WakeParent");
  expect(writeText.mock.calls[0][0]).toContain("priority:true");
  expect(writeText.mock.calls[0][0]).toContain("owner's direct authorization");
  fireEvent.click(screen.getByText("Authorize your bots to use Crew"));
  fireEvent.click(
    screen.getByRole("button", { name: "Copy bot authorization prompt" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(writeText.mock.calls[1][0]).toContain(`${window.location.origin}/mcp`);
  expect(writeText.mock.calls[1][0]).toContain("human-review rules");
  expect(writeText.mock.calls[1][0]).not.toContain("hooks.example");
  expect(crewApi.write).not.toHaveBeenCalled();
});

it("does not require a recipient acknowledgment for a dispatcher-only bridge test", async () => {
  config.dispatch_mode = "parent_bridge";
  config.setup = {
    can_test: true,
    can_enable: true,
    blockers: [],
    test_acknowledged: true,
    runtime_reported: true,
    parent_wake_reported: true,
    parent_received: true,
    recipient_acknowledged: false,
    bridge_test_recipient_agent_id: "build",
  };
  await open();
  expect(
    screen.getByText("Recipient: not needed for this dispatcher-only test"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Enable delivery" })).toBeEnabled();
  expect(screen.queryByText(/Native send:/)).not.toBeInTheDocument();
});
it("offers opt-in owner comment wakes and saves an owner-only handoff limit", async () => {
  const routing: Row = {
    id: "routing",
    revision: 7,
    singleton: "routing",
    max_bot_handoffs: 4,
  };
  fixtures.webhook_routing = [routing];
  await open();
  const comment = screen.getByLabelText(/Owner comment/);
  expect(comment).not.toBeChecked();
  const limit = screen.getByLabelText("Bot handoff limit");
  expect(limit).toHaveValue(4);
  const save = screen.getByRole("button", { name: "Save handoff limit" });
  expect(save).toBeDisabled();
  fireEvent.change(limit, { target: { value: "21" } });
  expect(save).toBeDisabled();
  fireEvent.change(limit, { target: { value: "2" } });
  fireEvent.click(save);
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.routing.update",
      { max_bot_handoffs: 2 },
      routing,
      "",
      { idempotency_key: expect.any(String) },
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});
