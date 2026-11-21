import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AgentStartupSettings from "./AgentStartupSettings";
import { crewApi, type Row } from "./crewApi";

const agent = { id: "manual", revision: 1, kind: "external" };
let rows: Record<string, Row[]>;
beforeEach(() => {
  rows = {
    agents: [agent],
    webhook_configs: [{ id: "config", revision: 5, scope: "global", enabled: true, receiver_host: "relay.example" }],
    webhook_mappings: [],
    webhook_routing: [{id:"routing",revision:1,paused:false}],
  };
  vi.spyOn(crewApi,"read").mockImplementation(async (collection) => rows[collection] || []);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("leaves a visible unchecked switch disabled without an active integration", async () => {
  rows.webhook_configs=[];
  render(<AgentStartupSettings agent={agent} onConfigured={vi.fn()} />);
  await screen.findByRole("link",{name:"Open integration settings"});
  const control = screen.getByRole("switch",{name:"Automatic startup"});
  expect(control).not.toBeChecked();
  expect(control).toBeDisabled();
});

it("requires the actual destination to be confirmed, then reflects saved state", async () => {
  const onConfigured=vi.fn();
  const write=vi.spyOn(crewApi,"write").mockImplementation(async () => {
    rows.agents=[{...agent,kind:"bot",revision:2}];
    rows.webhook_mappings=[{id:"map",revision:1,agent:agent.id,bot_ref:"provider-ref"}];
    return rows.agents[0];
  });
  render(<AgentStartupSettings agent={agent} onConfigured={onConfigured} />);
  await screen.findByText("Integration: relay.example");
  const control = screen.getByRole("switch",{name:"Automatic startup"});
  fireEvent.click(control);
  expect(control).not.toBeChecked();
  const confirm=screen.getByRole("button",{name:"Confirm destination"});
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox",{name:"Recipient reference"}),{target:{value:"provider-ref"}});
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  expect(write).toHaveBeenCalledWith("webhook.startup.update",{enabled:true,config_revision:5,mapping_revision:0,bot_ref:"provider-ref"},agent);
  await waitFor(()=>expect(control).toBeChecked());
  expect(screen.getByText("Recipient: provider-ref")).toBeInTheDocument();
  expect(onConfigured).toHaveBeenCalledWith(rows.agents[0]);
});

it("does not alter state after a conflicting write and can reload the current revision", async () => {
  rows.agents=[{...agent,kind:"bot"}];
  rows.webhook_mappings=[{id:"map",revision:2,agent:agent.id,bot_ref:"ref"}];
  const write=vi.spyOn(crewApi,"write").mockRejectedValue(Error("Revision conflict"));
  const saved=vi.fn();
  render(<AgentStartupSettings agent={rows.agents[0]} onConfigured={saved} />);
  await screen.findByText("Recipient: ref");
  const control=screen.getByRole("switch");
  expect(control).toBeChecked();
  fireEvent.click(control);
  expect(await screen.findByRole("alert")).toHaveTextContent("Revision conflict");
  expect(write).toHaveBeenCalledWith("webhook.startup.update",{enabled:false,mapping_revision:2},rows.agents[0]);
  expect(saved).not.toHaveBeenCalled();
  rows.agents=[{...rows.agents[0],revision:3,startup_disabled:true}];
  fireEvent.click(screen.getByRole("button",{name:"Reload settings"}));
  await waitFor(()=>expect(control).not.toBeChecked());
});
