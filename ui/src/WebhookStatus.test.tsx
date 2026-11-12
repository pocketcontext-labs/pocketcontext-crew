import {
  act,
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
  await screen.findByRole("button", { name: /Choose your dispatcher/ });
  await waitFor(() =>
    expect(screen.queryByText("Loading integration…")).toBeNull(),
  );
  // These tests exercise each step's content, so open every collapsed step.
  for (const step of document.querySelectorAll(
    '.crew-setup-toggle[aria-expanded="false"]',
  ))
    fireEvent.click(step);
  const selector = screen.getByRole("combobox", { name: "Crew dispatcher" });
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
  // A successful save finishes the step, so it closes; reopening shows empty fields.
  await waitFor(() =>
    expect(screen.queryByLabelText("Replacement secret")).toBeNull(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Enter webhook credentials/ }),
  );
  fireEvent.click(screen.getByText("Replace saved credentials"));
  expect(screen.getByLabelText("Replacement secret")).toHaveValue("");
  expect(screen.getByLabelText("Replacement webhook URL")).toHaveValue("");
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
it("never shows placeholder text as a bot name", async () => {
  fixtures.webhook_mappings[0].bot_ref = "grok-bot-0123456789abcdef";
  await open();
  for (const placeholder of ["Grok Bot reference", "Connected Grok Bot"])
    expect(screen.queryByText(placeholder)).toBeNull();
  // Without bot_name, the Crew agent and a shortened reference stand in.
  expect(
    screen.getAllByText(/Build bot \(grok-bot…abcdef\)/).length,
  ).toBeGreaterThanOrEqual(2);
  const learn = screen.getByRole("form", { name: "Learn routing" });
  expect(learn.querySelector("p")).toBeNull();
});
it("shows a saved bot display name and keeps it when only the reference changes", async () => {
  fixtures.webhook_mappings[0].bot_name = "Builder Grok";
  await open();
  expect(screen.getAllByText(/Builder Grok/).length).toBeGreaterThanOrEqual(2);
  const name = screen.getByLabelText("Bot display name for Build (optional)");
  expect(name).toHaveValue("Builder Grok");
  fireEvent.change(screen.getByLabelText("Grok Bot reference for Build"), {
    target: { value: "Build bot 2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Build mapping" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.mapping.update",
      { agent: "build", bot_ref: "Build bot 2" },
      fixtures.webhook_mappings[0],
      "",
      { idempotency_key: expect.any(String), expected_revision: 2 },
    ),
  );
});
it("saves an edited or cleared bot display name as bot_name", async () => {
  fixtures.webhook_mappings[0].bot_name = "Builder Grok";
  await open();
  const name = screen.getByLabelText("Bot display name for Build (optional)");
  const save = screen.getByRole("button", { name: "Save Build mapping" });
  expect(save).toBeDisabled();
  fireEvent.change(name, { target: { value: "  Builder  " } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.mapping.update",
      { agent: "build", bot_ref: "Build bot", bot_name: "Builder" },
      fixtures.webhook_mappings[0],
      "",
      { idempotency_key: expect.any(String), expected_revision: 2 },
    ),
  );
  vi.mocked(crewApi.write).mockClear();
  // The save reloads the settings; edits made while the form is disabled are dropped.
  await screen.findByText("Bot mapping saved.");
  await waitFor(() => expect(name).toBeEnabled());
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.click(save);
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.mapping.update",
      { agent: "build", bot_ref: "Build bot", bot_name: "" },
      fixtures.webhook_mappings[0],
      "",
      { idempotency_key: expect.any(String), expected_revision: 2 },
    ),
  );
});
it("asks the setup assistant to save bot names as bot_name", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Read setup prompt" }));
  const prompt = document.querySelector("pre.crew-copy-prompt")?.textContent;
  expect(prompt).toContain("display name as bot_name");
  expect(prompt).not.toContain("readable names");
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
  expect(prompt).toContain('id:"execution"');
  expect(prompt).toContain("capabilities_digest");
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
  fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "webhook.integration.update",
      {
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
  fireEvent.click(
    screen.getByRole("button", { name: "Copy group authorization prompt" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(writeText.mock.calls[1][0]).toContain("every bot in this group chat");
  expect(writeText.mock.calls[1][0]).toContain("Do not respond to other bots");
  expect(writeText.mock.calls[1][0]).toContain(`${window.location.origin}/mcp`);
  fireEvent.click(
    screen.getByRole("button", { name: "Copy bot authorization prompt" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
  expect(writeText.mock.calls[2][0]).toContain(`${window.location.origin}/mcp`);
  expect(writeText.mock.calls[2][0]).toContain("human-review rules");
  expect(writeText.mock.calls[2][0]).not.toContain("hooks.example");
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
const recommended = [
  "created",
  "assigned",
  "reassigned",
  "ready",
  "reopened",
  "review_outcome",
  "catch_up",
];
function withRouting(extra: Record<string, unknown> = {}) {
  const routing: Row = {
    id: "routing",
    revision: 7,
    singleton: "routing",
    max_bot_handoffs: 4,
    ...extra,
  };
  fixtures.webhook_routing = [routing];
  return routing;
}
const wakeRules = () => screen.getByRole("form", { name: "Wake rules" });
const saveWakeRules = () =>
  screen.getByRole("button", { name: "Save wake rules" });
it("shows wake rules outside Advanced with explanations and recommended values", async () => {
  withRouting();
  render(<WebhookStatus agents={agents} />);
  await screen.findByRole("form", { name: "Wake rules" });
  await waitFor(() =>
    expect(screen.queryByText("Loading integration…")).toBeNull(),
  );
  const advanced = screen
    .getByText("Advanced settings and recovery")
    .closest("details")!;
  expect(advanced).not.toHaveAttribute("open");
  expect(advanced).not.toContainElement(wakeRules());
  expect(wakeRules()).toBeVisible();
  const owner = screen.getByRole("checkbox", { name: /Owner comment/ });
  expect(owner).not.toBeChecked();
  expect(owner).toHaveAccessibleDescription(/agent comments never wake/);
  expect(
    screen.getByRole("checkbox", { name: /Marked ready/ }),
  ).toHaveAccessibleDescription(/normal way to release work/);
  for (const name of ["Created ready", "Assigned", "Explicit catch-up"])
    expect(
      screen.getByRole("checkbox", { name: new RegExp(`^${name}`) }),
    ).toHaveAccessibleName(`${name} Recommended: on`);
  for (const name of ["Unassigned (triage)", "Owner comment"])
    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
      }),
    ).toHaveAccessibleName(`${name} Recommended: off`);
  expect(screen.getByText(/No triage agent is chosen/)).toBeVisible();
  expect(screen.getByLabelText("Bot handoff limit")).toHaveValue(4);
  expect(screen.getByText("Recommended: 4")).toBeVisible();
  // The old Advanced controls are gone; instructions keep their own save.
  expect(
    screen.queryByRole("button", { name: "Save handoff limit" }),
  ).toBeNull();
  expect(screen.queryByText("Save advanced settings")).toBeNull();
  expect(saveWakeRules()).toBeDisabled();
});
it("names the current triage agent", async () => {
  withRouting({ triage_agent: "learn" });
  await open();
  expect(screen.getByText(/Triage agent: Learn\./)).toBeVisible();
});
it("resets to recommended values without saving", async () => {
  withRouting({ max_bot_handoffs: 9 });
  config.subscriptions = ["ready", "comment"];
  await open();
  const confirm = vi.spyOn(window, "confirm");
  fireEvent.click(screen.getByRole("button", { name: "Reset to recommended" }));
  const checked = Array.from(
    wakeRules().querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
  )
    .filter((box) => box.checked)
    .map((box) =>
      box.getAttribute("aria-describedby")?.replace("crew-wake-", ""),
    );
  expect(checked).toEqual(recommended);
  expect(
    screen.getByRole("checkbox", { name: /Owner comment/ }),
  ).not.toBeChecked();
  expect(screen.getByLabelText("Bot handoff limit")).toHaveValue(4);
  expect(
    screen.getByRole("button", { name: "Reset to recommended" }),
  ).toBeDisabled();
  expect(saveWakeRules()).toBeEnabled();
  expect(crewApi.write).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});
it("saves only a changed handoff limit, without a warning", async () => {
  const routing = withRouting();
  const confirm = vi.spyOn(window, "confirm");
  await open();
  const limit = screen.getByLabelText("Bot handoff limit");
  fireEvent.change(limit, { target: { value: "21" } });
  expect(saveWakeRules()).toBeDisabled();
  expect(screen.getByText("Enter a whole number from 1 to 20.")).toBeVisible();
  fireEvent.change(limit, { target: { value: "2" } });
  expect(screen.queryByText(/Saving changed wake rules/)).toBeNull();
  fireEvent.click(saveWakeRules());
  await screen.findByText("Bot handoff limit saved.");
  expect(confirm).not.toHaveBeenCalled();
  expect(crewApi.write).toHaveBeenCalledTimes(1);
  expect(crewApi.write).toHaveBeenCalledWith(
    "webhook.routing.update",
    { max_bot_handoffs: 2 },
    routing,
    "",
    { idempotency_key: expect.any(String) },
  );
});
it("warns and confirms before saving changed rules, then sends only subscriptions", async () => {
  withRouting();
  config.enabled = true;
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
  await open();
  const comment = screen.getByRole("checkbox", { name: /Owner comment/ });
  fireEvent.click(comment);
  const warning = screen.getByText(/Saving changed wake rules/);
  expect(warning).toHaveTextContent(
    "Saving changed wake rules turns delivery off, cancels queued wakes and interrupts bots working on Ready tasks. Turn delivery back on afterwards.",
  );
  fireEvent.click(saveWakeRules());
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0]).toContain("turns delivery off");
  expect(crewApi.write).not.toHaveBeenCalled();
  confirm.mockReturnValueOnce(true);
  fireEvent.click(saveWakeRules());
  await screen.findByText(/Wake rules saved\. Delivery is off/);
  expect(crewApi.write).toHaveBeenCalledTimes(1);
  expect(crewApi.write).toHaveBeenCalledWith(
    "webhook.integration.update",
    { subscriptions: ["created", "ready", "comment"] },
    config,
    "",
    { idempotency_key: expect.any(String) },
  );
});
it("requires at least one rule and treats a reordered set as unchanged", async () => {
  withRouting();
  config.subscriptions = ["ready", "created"];
  await open();
  expect(saveWakeRules()).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Created ready/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Marked ready/ }));
  expect(screen.getByText("Choose at least one rule.")).toBeVisible();
  expect(saveWakeRules()).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Marked ready/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Created ready/ }));
  expect(saveWakeRules()).toBeDisabled();
  expect(screen.queryByText(/Saving changed wake rules/)).toBeNull();
});
it("reports a partial save when the limit saves but the rules do not, and reloads", async () => {
  const routing = withRouting();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(crewApi.write)
    .mockResolvedValueOnce(routing)
    .mockRejectedValueOnce({ status: 409 });
  await open();
  fireEvent.change(screen.getByLabelText("Bot handoff limit"), {
    target: { value: "6" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Assigned/ }));
  const reads = vi.mocked(crewApi.read).mock.calls.length;
  fireEvent.click(saveWakeRules());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The handoff limit was saved, but the rule changes were not. This configuration changed elsewhere.",
  );
  const calls = vi.mocked(crewApi.write).mock.calls;
  expect(calls.map((c) => c[0])).toEqual([
    "webhook.routing.update",
    "webhook.integration.update",
  ]);
  await waitFor(() =>
    expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
  );
  // The unsaved rule change stays in the form for another try.
  expect(screen.getByRole("checkbox", { name: /Assigned/ })).toBeChecked();
});

const stepToggle = (name: RegExp) => screen.getByRole("button", { name });
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3600_000).toISOString();
async function backgroundRefresh() {
  const reads = vi.mocked(crewApi.read).mock.calls.length;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
  );
  await act(async () => {});
}
function completeSetup() {
  config.enabled = true;
  fixtures.webhook_mappings.push({
    id: "learn-mapping",
    revision: 1,
    agent: "learn",
    bot_ref: "Learn bot",
  });
}
async function settled() {
  render(<WebhookStatus agents={agents} />);
  await screen.findByRole("heading", { name: "Grok setup" });
  await waitFor(() =>
    expect(screen.queryByText("Loading integration…")).toBeNull(),
  );
}
it("replaces finished setup with one status line and reveals it on request", async () => {
  completeSetup();
  await settled();
  expect(
    screen.getByText("Automatic wake-ups: on").parentElement,
  ).toHaveTextContent("Automatic wake-ups: on · 2 of 2 agents mapped");
  expect(screen.queryByRole("region", { name: "Prepare Grok" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review setup" }));
  expect(screen.getByRole("region", { name: "Prepare Grok" })).toBeVisible();
  // Reachable once revealed: the optional step opens first, finished ones reopen.
  expect(stepToggle(/Verify task routing/)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(stepToggle(/Enable future notifications/));
  expect(screen.getByRole("button", { name: "Disable delivery" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Hide setup" }));
  expect(screen.queryByRole("region", { name: "Prepare Grok" })).toBeNull();
});
it("shows guided steps, not the status line, when delivery is off or a step lapses", async () => {
  completeSetup();
  config.enabled = false;
  await settled();
  expect(screen.queryByText("Automatic wake-ups: on")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Enable delivery" }),
  ).toBeVisible();
  cleanup();
  config.enabled = true;
  config.setup = {
    can_test: true,
    can_enable: false,
    blockers: [{ code: "bridge_overdue", message: "Inspect the conversations." }],
  };
  await settled();
  expect(screen.queryByText("Automatic wake-ups: on")).toBeNull();
  expect(screen.getByLabelText("Connection test progress")).toBeVisible();
  expect(screen.queryByText("Review setup")).toBeNull();
});
it("keeps the setup-collapsed button for an unconfigured install", async () => {
  fixtures.webhook_configs = [
    {
      ...config,
      agent: "",
      url_configured: false,
      secret_configured: false,
      setup: undefined,
    },
  ];
  fixtures.webhook_mappings = [];
  render(<WebhookStatus agents={agents} collapsible />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Set up automatic wake-ups" }),
  );
  expect(screen.getByRole("heading", { name: "Grok setup" })).toBeVisible();
});
it("expands only the first incomplete step and reopens finished ones", async () => {
  config.url_configured = false;
  config.secret_configured = false;
  completeSetup();
  config.enabled = false;
  await settled();
  // Dispatcher and Grok are done; credentials are the first incomplete step.
  expect(stepToggle(/Enter webhook credentials/)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByLabelText("Webhook URL")).toBeVisible();
  expect(stepToggle(/Choose your dispatcher/)).toHaveTextContent("Complete");
  expect(stepToggle(/Choose your dispatcher/)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.queryByRole("combobox", { name: "Crew dispatcher" })).toBeNull();
  expect(stepToggle(/Enable future notifications/)).not.toHaveTextContent(
    "Complete",
  );
  expect(screen.queryByRole("button", { name: "Enable delivery" })).toBeNull();
  fireEvent.click(stepToggle(/Choose your dispatcher/));
  expect(
    screen.getByRole("combobox", { name: "Crew dispatcher" }),
  ).toBeVisible();
});
it("keeps a step in progress and its typed values across a background refresh", async () => {
  config.url_configured = false;
  config.secret_configured = false;
  completeSetup();
  config.enabled = false;
  await settled();
  fireEvent.change(screen.getByLabelText("Webhook URL"), {
    target: { value: "https://typing.example/hook" },
  });
  fireEvent.change(screen.getByLabelText("Webhook secret"), {
    target: { value: "synthetic-typed-secret" },
  });
  // A background change makes an earlier step the first incomplete one.
  fixtures.webhook_mappings = [fixtures.webhook_mappings[0]];
  await backgroundRefresh();
  expect(stepToggle(/Prepare Grok/)).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByLabelText("Webhook URL")).toHaveValue(
    "https://typing.example/hook",
  );
  expect(screen.getByLabelText("Webhook secret")).toHaveValue(
    "synthetic-typed-secret",
  );
  // Closing and reopening keeps a draft in memory without showing it as text.
  fireEvent.click(stepToggle(/Enter webhook credentials/));
  expect(screen.queryByLabelText("Webhook secret")).toBeNull();
  fireEvent.click(stepToggle(/Enter webhook credentials/));
  const secret = screen.getByLabelText("Webhook secret");
  expect(secret).toHaveValue("synthetic-typed-secret");
  expect(secret).toHaveAttribute("type", "password");
  expect(document.body).not.toHaveTextContent("synthetic-typed-secret");
});
it("does not overwrite edited advanced fields or mapping drafts on refresh", async () => {
  await open();
  const reporting = screen.getByRole("textbox", {
    name: "Reporting instructions",
  });
  fireEvent.change(reporting, { target: { value: "Draft reporting" } });
  const reference = screen.getByLabelText("Grok Bot reference for Learn");
  fireEvent.change(reference, { target: { value: "Draft bot" } });
  config.revision = 5;
  config.role_instructions = "Server role";
  config.reporting_instructions = "Server reporting";
  fixtures.webhook_mappings.push({
    id: "learn-mapping",
    revision: 3,
    agent: "learn",
    bot_ref: "Elsewhere bot",
  });
  await backgroundRefresh();
  expect(
    screen.getByRole("textbox", { name: "Reporting instructions" }),
  ).toHaveValue("Draft reporting");
  expect(
    screen.getByRole("textbox", { name: "Bot role instructions" }),
  ).toHaveValue("Server role");
  expect(screen.getByLabelText("Grok Bot reference for Learn")).toHaveValue(
    "Draft bot",
  );
});
it("refreshes silently: no button, no loading flicker, no error banner, not while hidden", async () => {
  await settled();
  expect(screen.queryByRole("button", { name: "Refresh integration" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Connect your Grok team" })).toBeNull();
  let finish: (rows: Row[]) => void = () => {};
  const read = vi.mocked(crewApi.read);
  read.mockImplementationOnce(
    () => new Promise<Row[]>((resolve) => (finish = resolve)),
  );
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.queryByText("Loading integration…")).toBeNull();
  await act(async () => finish([config]));
  await act(async () => {});
  read.mockRejectedValue(new Error("private-network-detail"));
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {});
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Loading integration…")).toBeNull();
  const hidden = vi
    .spyOn(document, "hidden", "get")
    .mockReturnValue(true);
  const reads = read.mock.calls.length;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(read.mock.calls.length).toBe(reads);
  hidden.mockRestore();
});
const delivery = (id: string, hours: number, extra: Record<string, unknown> = {}): Row => ({
  id,
  revision: 1,
  state: "accepted",
  attempts: 1,
  task: `task-${id}`,
  created: hoursAgo(hours),
  ...extra,
});
it("shows the latest three activity entries until Show all is used", async () => {
  fixtures.webhook_deliveries = [1, 2, 3, 4, 5].map((n) => delivery(`d${n}`, n));
  completeSetup();
  await settled();
  expect(document.querySelectorAll(".crew-event")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Show all (5)" }));
  expect(document.querySelectorAll(".crew-event")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});
it("pluralizes attempts", async () => {
  fixtures.webhook_deliveries = [
    delivery("one", 1),
    delivery("two", 2, { attempts: 2 }),
  ];
  await settled();
  expect(screen.getByText("1 attempt")).toBeVisible();
  expect(screen.getByText("2 attempts")).toBeVisible();
});
const overdueExecution = (id: string, extra: Record<string, unknown> = {}): Row => ({
  id: `execution-${id}`,
  revision: 1,
  delivery: id,
  task: `task-${id}`,
  state: "handed_off",
  waiting_overdue: true,
  generation: 2,
  handoff_at: hoursAgo(56),
  ...extra,
});
const warningText = () =>
  screen.getByText(/Recipient acknowledgment overdue/);
it("quiets an overdue entry older than a day when its task is unknown", async () => {
  fixtures.webhook_deliveries = [delivery("d1", 56)];
  fixtures.webhook_executions = [overdueExecution("d1")];
  await settled();
  expect(warningText()).toHaveClass("crew-footnote");
  expect(warningText()).toHaveTextContent("56h elapsed");
});
it("warns about a recent overdue handoff", async () => {
  fixtures.webhook_deliveries = [delivery("d1", 2)];
  fixtures.webhook_executions = [
    overdueExecution("d1", { handoff_at: hoursAgo(2) }),
  ];
  await settled();
  expect(warningText()).toHaveClass("crew-assignment-warning");
});
it("quiets a recent overdue entry superseded by a later wake for the same task", async () => {
  fixtures.webhook_deliveries = [
    delivery("d1", 2, { task: "shared" }),
    delivery("d2", 1, { task: "shared" }),
  ];
  fixtures.webhook_executions = [
    overdueExecution("d1", { task: "shared", handoff_at: hoursAgo(2) }),
  ];
  await settled();
  expect(warningText()).toHaveClass("crew-footnote");
  expect(warningText()).toHaveTextContent("Later activity replaced");
});
it("quiets an overdue entry whose task has moved to a new wake generation", async () => {
  fixtures.webhook_deliveries = [delivery("d1", 2)];
  fixtures.webhook_executions = [overdueExecution("d1", { handoff_at: hoursAgo(2) })];
  render(
    <WebhookStatus
      agents={agents}
      tasks={[
        { id: "task-d1", revision: 1, status: "todo", readiness: "ready", wake_generation: 3 },
      ]}
    />,
  );
  await screen.findByRole("heading", { name: "Grok setup" });
  await waitFor(() => expect(warningText()).toHaveClass("crew-footnote"));
});
it("keeps an old entry prominent and listed while its task still waits on it", async () => {
  fixtures.webhook_deliveries = [
    delivery("d1", 1),
    delivery("d2", 2),
    delivery("d3", 3),
    delivery("stuck", 56),
  ];
  fixtures.webhook_executions = [overdueExecution("stuck")];
  completeSetup();
  render(
    <WebhookStatus
      agents={agents}
      tasks={[
        { id: "task-stuck", revision: 1, status: "in_progress", readiness: "ready", wake_generation: 2 },
      ]}
    />,
  );
  await screen.findByText("Automatic wake-ups: on");
  await waitFor(() =>
    expect(warningText()).toHaveClass("crew-assignment-warning"),
  );
  expect(document.querySelectorAll(".crew-event")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});
it("lists wakes not received for open tasks dispatched to someone else, without retry or dismiss", async () => {
  fixtures.webhook_bridges = [
    {
      id: "bridge-1",
      revision: 1,
      task_id: "task000000000aa",
      recipient_agent: "learn",
      overdue: true,
      deadline_at: "2026-11-10T09:30:00.000Z",
      created: "2026-11-10 09:00:00.000Z",
    },
    {
      id: "bridge-self",
      revision: 1,
      task_id: "task000000000bb",
      overdue: true,
    },
    {
      id: "bridge-done",
      revision: 1,
      task_id: "task000000000cc",
      overdue: true,
    },
    { id: "bridge-test", revision: 1, task_id: "", overdue: true },
    {
      id: "bridge-fine",
      revision: 1,
      task_id: "task000000000dd",
      overdue: false,
    },
  ];
  const tasks: Row[] = [
    { id: "task000000000aa", revision: 1, title: "Stranded copy", status: "todo", assigned_agent: "learn" },
    { id: "task000000000bb", revision: 1, title: "Self filed", status: "todo", assigned_agent: "build", created_by_agent: "Build" },
    { id: "task000000000cc", revision: 1, title: "Done already", status: "done", assigned_agent: "learn" },
    { id: "task000000000dd", revision: 1, title: "On time", status: "todo", assigned_agent: "learn" },
  ];
  render(<WebhookStatus agents={agents} tasks={tasks} />);
  const section = await screen.findByRole("region", {
    name: "Wakes not received",
  });
  const items = section.querySelectorAll("li");
  expect(items).toHaveLength(1);
  const link = screen.getByRole("link", { name: "Stranded copy" });
  expect(link).toHaveAttribute("href", "#/tasks/task000000000aa");
  expect(items[0]).toHaveTextContent("Learn");
  expect(items[0].querySelector("time")).toHaveAttribute(
    "dateTime",
    "2026-11-10T09:30:00.000Z",
  );
  expect(section.querySelector("button")).toBeNull();
});
it("shows no wake list when nothing is overdue or bridges cannot be read", async () => {
  vi.mocked(crewApi.read).mockImplementation(async (c) => {
    if (c === "webhook_bridges") throw new Error("synthetic");
    return fixtures[c] || [];
  });
  render(<WebhookStatus agents={agents} tasks={[]} />);
  await screen.findByRole("heading", { name: "Grok setup" });
  await waitFor(() =>
    expect(screen.queryByText("Loading integration…")).toBeNull(),
  );
  expect(screen.queryByRole("region", { name: "Wakes not received" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
