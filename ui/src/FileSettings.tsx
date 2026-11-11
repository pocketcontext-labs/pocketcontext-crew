/**
 * Files settings: storage usage and limit (`storage.update`, revision-checked)
 * and the one-time upload links (`upload_link.revoke`). Link tokens are shown
 * only when a link is created; this list never has them.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { pb } from "./api";
import { formatBytes } from "./attachmentsApi";
import { crewApi, val, type Row } from "./crewApi";
import { itemPath } from "./itemLink";
import "./upload.css";

const GIB = 1024 ** 3;
export const MIN_STORAGE_LIMIT = 1024 ** 2;
export const MAX_STORAGE_LIMIT = 1024 ** 4;
const LINK_PAGE = 100;
const RECENT_SHOWN = 20;

/** Bytes for a GB value (GB as shown: 1024³ bytes), or an error message. */
export function storageLimitFromGb(text: string): number | string {
  const value = Number(text.trim().replace(",", "."));
  if (!text.trim() || !Number.isFinite(value) || value <= 0)
    return "Enter a size in GB, for example 5 or 0.5.";
  const bytes = Math.round(value * GIB);
  if (bytes < MIN_STORAGE_LIMIT)
    return "The limit is at least 1 MB (0.001 GB).";
  if (bytes > MAX_STORAGE_LIMIT) return "The limit is at most 1 TB (1024 GB).";
  return bytes;
}

const gbText = (bytes: number) =>
  String(Math.round((bytes / GIB) * 1000) / 1000);

const when = (iso: unknown) => {
  const date = new Date(String(iso || ""));
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const stateLabels: Record<string, string> = {
  active: "Active",
  used: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

function errorText(e: unknown, fallback: string) {
  const status = (e as { status?: number })?.status;
  if (status === 409)
    return "This changed elsewhere. Reloaded; check and try again.";
  const message = (e as { response?: { message?: unknown } })?.response
    ?.message;
  return typeof message === "string" && message ? message : fallback;
}

export default function FileSettings({
  tasks,
  notes,
}: {
  tasks: Row[];
  notes: Row[];
}) {
  const [settings, setSettings] = useState<Row | null>(null);
  const [links, setLinks] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [limit, setLimit] = useState("");
  const [limitError, setLimitError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const loadSettings = useCallback(async () => {
    const [row] = await crewApi.read("settings");
    if (!row) throw new Error("No settings");
    setSettings(row);
    setLimit(gbText(Number(row.storage_limit_bytes) || 0));
  }, []);
  const loadLinks = useCallback(async () => {
    // One page: links expire within a day, so the newest are the useful ones.
    const response = await pb.send<{ items: Row[] }>("/api/crew/read", {
      method: "POST",
      body: { collection: "upload_links", limit: LINK_PAGE },
    });
    setLinks(response.items);
  }, []);
  useEffect(() => {
    Promise.all([loadSettings(), loadLinks()]).then(
      () => setLoadError(""),
      () => setLoadError("Could not load file settings. Refresh to try again."),
    );
  }, [loadSettings, loadLinks]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    const bytes = storageLimitFromGb(limit);
    if (typeof bytes === "string") return setLimitError(bytes);
    setLimitError("");
    setNotice("");
    setBusy("limit");
    try {
      const row = await crewApi.write(
        "storage.update",
        { storage_limit_bytes: bytes },
        settings,
      );
      setSettings(row);
      setLimit(gbText(Number(row.storage_limit_bytes) || bytes));
      setNotice("Storage limit saved.");
    } catch (e) {
      setLimitError(errorText(e, "Could not save the storage limit."));
      if ((e as { status?: number })?.status === 409)
        await loadSettings().catch(() => {});
    } finally {
      setBusy("");
    }
  };

  const titles = new Map<string, Row>();
  for (const row of [...tasks, ...notes]) titles.set(row.id, row);
  const revoke = async (link: Row) => {
    const parent = titles.get(val(link, "parent"));
    if (
      !window.confirm(
        `Revoke this upload link${parent ? ` for “${val(parent, "title")}”` : ""}? It stops accepting files right away.`,
      )
    )
      return;
    setBusy(link.id);
    setNotice("");
    try {
      await crewApi.write("upload_link.revoke", {}, link);
      setNotice("Upload link revoked.");
    } catch (e) {
      setNotice(errorText(e, "Could not revoke the upload link."));
    } finally {
      await loadLinks().catch(() => {});
      setBusy("");
    }
  };

  const used = Number(settings?.storage_used_bytes) || 0;
  const max = Number(settings?.storage_limit_bytes) || 0;
  const share = max ? Math.min(1, used / max) : 0;
  const active = (links ?? []).filter((l) => val(l, "state") === "active");
  const recent = (links ?? [])
    .filter((l) => val(l, "state") !== "active")
    .slice(0, RECENT_SHOWN);

  const linkRow = (link: Row) => {
    const kind = val(link, "parent_kind") === "note" ? "note" : "task";
    const parent = titles.get(val(link, "parent"));
    const title = parent ? val(parent, "title") : "";
    const state = val(link, "state");
    return (
      <li key={link.id}>
        <div>
          <a
            href={itemPath(
              kind,
              parent ?? { id: val(link, "parent"), revision: 0 },
            )}
          >
            {title || (kind === "note" ? "A note" : "A task")}
          </a>
          <small>
            {stateLabels[state] ?? state} · created {when(link.created)} ·{" "}
            {state === "active" ? "expires" : "until"} {when(link.expires_at)} ·{" "}
            {Number(link.files_added) || 0}/{Number(link.max_files) || 0} files
          </small>
        </div>
        {state === "active" && (
          <button
            type="button"
            disabled={busy === link.id}
            onClick={() => void revoke(link)}
            aria-label={`Revoke upload link for ${title || kind}`}
          >
            Revoke
          </button>
        )}
      </li>
    );
  };

  return (
    <section
      className="crew-file-settings"
      aria-labelledby="crew-file-settings-title"
    >
      <h2 id="crew-file-settings-title">Files</h2>
      {loadError && <p role="alert">{loadError}</p>}
      {notice && <p role="status">{notice}</p>}
      {settings && (
        <>
          <h3>Storage</h3>
          <p>
            {formatBytes(used)} of {formatBytes(max)} used
          </p>
          <div
            className={`crew-storage-bar${share >= 1 ? " crew-storage-full" : ""}`}
            role="meter"
            aria-label="Storage used"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={used}
            aria-valuetext={`${formatBytes(used)} of ${formatBytes(max)}`}
          >
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <form className="crew-storage-form" onSubmit={(e) => void save(e)}>
            <label>
              Storage limit (GB)
              <input
                inputMode="decimal"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                aria-invalid={limitError ? true : undefined}
                aria-describedby="crew-storage-note"
              />
            </label>
            <button type="submit" disabled={busy === "limit"}>
              Save limit
            </button>
          </form>
          {limitError && <p role="alert">{limitError}</p>}
          <p id="crew-storage-note">
            From 1 MB to 1 TB. Archived files count too: Crew never deletes
            files. A limit below what is used deletes nothing; new files are
            refused until you raise it.
          </p>
        </>
      )}
      {links && (
        <>
          <h3>Upload links</h3>
          <p>
            Create a link from a task or note. Each link works once and is shown
            only when it is created.
          </p>
          {active.length ? (
            <ul className="crew-upload-links" aria-label="Active upload links">
              {active.map(linkRow)}
            </ul>
          ) : (
            <p>No active upload links.</p>
          )}
          {recent.length > 0 && (
            <details>
              <summary>
                Recent used, expired or revoked links ({recent.length})
              </summary>
              <ul
                className="crew-upload-links"
                aria-label="Recent upload links"
              >
                {recent.map(linkRow)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
