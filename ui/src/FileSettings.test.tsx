import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pb } from "./api";
import { crewApi, type Row } from "./crewApi";
import FileSettings, { storageLimitFromGb } from "./FileSettings";

const GIB = 1024 ** 3;
const task: Row = {
  id: "task00000000001",
  revision: 1,
  title: "Crash on save",
  path: "#/tasks/crash-on-save-task00000000001",
};
const note: Row = { id: "note00000000001", revision: 1, title: "Launch notes" };
const later = new Date(Date.now() + 10 * 60000).toISOString();
const earlier = new Date(Date.now() - 60 * 60000).toISOString();
let settings: Row;
let links: Row[];
let writes: { action: string; data: unknown; row?: Row }[];

beforeEach(() => {
  settings = {
    id: "settings0000001",
    revision: 3,
    storage_limit_bytes: 5 * GIB,
    storage_used_bytes: 1.25 * GIB,
    max_file_bytes: 20 * 1024 ** 2,
    max_active_attachments: 20,
  };
  links = [
    {
      id: "link00000000001",
      revision: 1,
      parent_kind: "task",
      parent: task.id,
      state: "active",
      created: earlier,
      expires_at: later,
      max_files: 10,
      files_added: 0,
    },
    {
      id: "link00000000002",
      revision: 2,
      parent_kind: "note",
      parent: note.id,
      state: "used",
      created: earlier,
      expires_at: earlier,
      max_files: 5,
      files_added: 2,
    },
    {
      id: "link00000000003",
      revision: 2,
      parent_kind: "task",
      parent: "gonetask0000001",
      state: "expired",
      created: earlier,
      expires_at: earlier,
      max_files: 10,
      files_added: 0,
    },
  ];
  writes = [];
  vi.spyOn(crewApi, "read").mockImplementation(async (collection) =>
    collection === "settings" ? [settings] : [],
  );
  vi.spyOn(pb, "send").mockImplementation(
    async (path: string, options?: { body?: unknown }) => {
      expect(path).toBe("/api/crew/read");
      expect((options?.body as { collection: string }).collection).toBe(
        "upload_links",
      );
      return { items: links } as never;
    },
  );
  vi.spyOn(crewApi, "write").mockImplementation(async (action, data, row) => {
    writes.push({ action, data, row });
    if (action === "storage.update") {
      settings = {
        ...settings,
        revision: settings.revision + 1,
        storage_limit_bytes: (data as { storage_limit_bytes: number })
          .storage_limit_bytes,
      };
      return settings;
    }
    links = links.map((l) =>
      l.id === row?.id
        ? { ...l, state: "revoked", revision: l.revision + 1 }
        : l,
    );
    return links[0];
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("storage limit input", () => {
  it("converts GB and enforces 1 MiB to 1 TiB", () => {
    expect(storageLimitFromGb("5")).toBe(5 * GIB);
    expect(storageLimitFromGb("0,5")).toBe(GIB / 2);
    expect(storageLimitFromGb("0.001")).toBe(Math.round(0.001 * GIB));
    expect(storageLimitFromGb("0.0001")).toMatch(/at least 1 MB/);
    expect(storageLimitFromGb("1025")).toMatch(/at most 1 TB/);
    expect(storageLimitFromGb("1024")).toBe(1024 * GIB);
    expect(storageLimitFromGb("abc")).toMatch(/Enter a size/);
    expect(storageLimitFromGb("")).toMatch(/Enter a size/);
  });
});

describe("FileSettings", () => {
  it("shows usage and saves the limit with the settings revision", async () => {
    render(<FileSettings tasks={[task]} notes={[note]} />);
    expect(
      await screen.findByText("1.3 GB of 5.0 GB used"),
    ).toBeInTheDocument();
    const meter = screen.getByRole("meter", { name: "Storage used" });
    expect(meter).toHaveAttribute("aria-valuenow", String(1.25 * GIB));
    expect(screen.getByText(/Archived files count too/)).toBeInTheDocument();
    const input = screen.getByLabelText("Storage limit (GB)");
    expect(input).toHaveValue("5");
    fireEvent.change(input, { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 1 TB");
    expect(writes).toHaveLength(0);
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByText("Storage limit saved.")).toBeInTheDocument();
    expect(writes[0]).toMatchObject({
      action: "storage.update",
      data: { storage_limit_bytes: 8 * GIB },
    });
    expect(writes[0].row?.revision).toBe(3);
    expect(screen.getByText("1.3 GB of 8.0 GB used")).toBeInTheDocument();
  });
  it("reloads after a revision conflict", async () => {
    render(<FileSettings tasks={[task]} notes={[note]} />);
    await screen.findByText("1.3 GB of 5.0 GB used");
    vi.mocked(crewApi.write).mockRejectedValueOnce(
      Object.assign(new Error("conflict"), { status: 409 }),
    );
    settings = { ...settings, revision: 4, storage_limit_bytes: 6 * GIB };
    fireEvent.change(screen.getByLabelText("Storage limit (GB)"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed elsewhere/,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Storage limit (GB)")).toHaveValue("6"),
    );
  });
  it("lists active links with their item, collapses the rest, and revokes after confirming", async () => {
    render(<FileSettings tasks={[task]} notes={[note]} />);
    const active = await screen.findByRole("list", {
      name: "Active upload links",
    });
    const link = within(active).getByRole("link", { name: "Crash on save" });
    expect(link).toHaveAttribute("href", task.path);
    expect(
      within(active).getByText(
        /Active · created .* · expires .* · 0\/10 files/,
      ),
    ).toBeInTheDocument();
    const recent = screen.getByRole("list", {
      name: "Recent upload links",
      hidden: true,
    });
    expect(recent.closest("details")).not.toHaveAttribute("open");
    expect(
      within(recent).getByRole("link", { name: "Launch notes", hidden: true }),
    ).toHaveAttribute("href", "#/notes/" + note.id);
    expect(
      within(recent).getByText(/Used · .* 2\/5 files/),
    ).toBeInTheDocument();
    expect(
      within(recent).getByRole("link", { name: "A task", hidden: true }),
    ).toHaveAttribute("href", "#/tasks/gonetask0000001");
    expect(within(recent).queryByRole("button", { hidden: true })).toBeNull();
    // No token is ever shown.
    expect(document.body.textContent).not.toMatch(/#\/upload\//);
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const revoke = within(active).getByRole("button", {
      name: "Revoke upload link for Crash on save",
    });
    fireEvent.click(revoke);
    expect(writes).toHaveLength(0);
    fireEvent.click(revoke);
    expect(await screen.findByText("Upload link revoked.")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(writes[0]).toMatchObject({ action: "upload_link.revoke", data: {} });
    expect(writes[0].row?.id).toBe("link00000000001");
    expect(
      await screen.findByText("No active upload links."),
    ).toBeInTheDocument();
  });
});
