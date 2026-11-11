/**
 * The one-time upload page at `#/upload/<token>`: no sign-in, no Crew data
 * beyond the task or note title, one batch in one request. The token is read
 * from the fragment and sent only in the `X-Crew-Upload-Token` request header
 * (never in a URL); it is never stored, and the owner's session (if this
 * browser has one) is never sent.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Brand from "./Brand";
import { formatBytes, looksLikeImage, screenshotName } from "./attachmentsApi";
import "./upload.css";

export type UploadInfo = {
  parent_kind: "task" | "note";
  title: string;
  expires_at: string;
  max_files: number;
  max_file_bytes: number;
  max_request_bytes: number;
};
export type UploadFileResult = {
  index: number;
  name: string;
  ok: boolean;
  error?: { code: string; message: string };
};
export type UploadOutcome = { added: number; results: UploadFileResult[] };

/** A refused request: `retryAfter` (seconds) on 429/503, `results` on 400. */
export class UploadLinkError extends Error {
  status: number;
  retryAfter: number;
  results: UploadFileResult[];
  constructor(
    message: string,
    status = 0,
    retryAfter = 0,
    results: UploadFileResult[] = [],
  ) {
    super(message);
    this.name = "UploadLinkError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.results = results;
  }
}

const retryAfterOf = (value: string | null) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
};

export const TOKEN_HEADER = "X-Crew-Upload-Token";

/** One object, so tests can replace either call. */
export const uploadLinkApi = {
  async info(token: string): Promise<UploadInfo> {
    let response: Response;
    try {
      response = await fetch("/api/crew/upload-link/info", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          [TOKEN_HEADER]: token,
        },
        body: "{}",
      });
    } catch {
      throw new UploadLinkError("Network error");
    }
    let body: Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      /* Not JSON. */
    }
    if (!response.ok)
      throw new UploadLinkError(
        typeof body.message === "string" ? body.message : "",
        response.status,
        retryAfterOf(response.headers.get("Retry-After")),
      );
    return body as unknown as UploadInfo;
  },
  /** The whole batch in one multipart request, with upload progress. */
  send(
    token: string,
    files: File[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<UploadOutcome> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const file of files) form.append("files", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/crew/upload-link/upload");
      xhr.withCredentials = false;
      xhr.responseType = "text";
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader(TOKEN_HEADER, token);
      if (onProgress)
        xhr.upload.onprogress = (e) =>
          onProgress(e.loaded, e.lengthComputable ? e.total : 0);
      xhr.onerror = () => reject(new UploadLinkError("Network error"));
      xhr.onabort = () => reject(new UploadLinkError("Network error"));
      xhr.onload = () => {
        let body: Record<string, unknown> = {};
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          /* Non-JSON error page. */
        }
        const results = Array.isArray(body.results)
          ? (body.results as UploadFileResult[])
          : [];
        if (xhr.status >= 200 && xhr.status < 300)
          return resolve({ added: Number(body.added) || 0, results });
        reject(
          new UploadLinkError(
            typeof body.message === "string" ? body.message : "",
            xhr.status,
            retryAfterOf(xhr.getResponseHeader("Retry-After")),
            results,
          ),
        );
      };
      xhr.send(form);
    });
  },
};

type Staged = { key: number; file: File; preview: string };
type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "sending"; loaded: number; total: number }
  | { kind: "done"; outcome: UploadOutcome; names: string[] }
  | { kind: "gone"; maybeSent: boolean };

export const goneMessage =
  "This link has expired or was already used. Ask for a new one.";

function timeText(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    [],
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        },
  );
}

const fileCount = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

let nextKey = 1;

export default function UploadPage({ token }: { token: string }) {
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [staged, setStaged] = useState<Staged[]>([]);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<UploadFileResult[]>([]);
  const [wait, setWait] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const networkFailed = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  // Blob previews live only while their file is staged.
  useEffect(
    () => () => {
      for (const s of stagedRef.current)
        if (s.preview) URL.revokeObjectURL(s.preview);
    },
    [],
  );

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    let active = true;
    if (!token) {
      setPhase({ kind: "gone", maybeSent: false });
      return;
    }
    setError("");
    uploadLinkApi.info(token).then(
      (value) => {
        if (!active) return;
        setInfo(value);
        setPhase({ kind: "ready" });
      },
      (e: UploadLinkError) => {
        if (!active) return;
        if (e.status === 404 || e.status === 410)
          return setPhase({ kind: "gone", maybeSent: false });
        if (e.status === 429) setWait(e.retryAfter || 5);
        setError(
          e.status === 429
            ? "Too many upload requests right now."
            : "Could not open this upload link. Check your connection and try again.",
        );
      },
    );
    return () => {
      active = false;
    };
  }, [token, loadAttempt]);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    setFailures([]);
    setError("");
    setStaged((current) => {
      const taken = current.map((s) => s.file.name);
      const added = files.map((original) => {
        let file = original;
        // Pasted screenshots arrive as "image.png"; give them a dated name.
        if (!original.name || /^image\.\w+$/.test(original.name)) {
          const name = screenshotName(taken, original.type || "image/png");
          taken.push(name);
          file = new File([original], name, { type: original.type });
        }
        return {
          key: nextKey++,
          file,
          preview: looksLikeImage(file) ? URL.createObjectURL(file) : "",
        };
      });
      return [...current, ...added];
    });
  }, []);

  const open = phase.kind === "ready";
  useEffect(() => {
    if (!open) return;
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      add(files);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [open, add]);

  const remove = (key: number) =>
    setStaged((current) => {
      setFailures([]);
      const gone = current.find((s) => s.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return current.filter((s) => s.key !== key);
    });

  const clearStaged = () => {
    for (const s of stagedRef.current)
      if (s.preview) URL.revokeObjectURL(s.preview);
    setStaged([]);
  };

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    add([...(e.target.files ?? [])]);
    e.target.value = "";
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (open) add([...(e.dataTransfer?.files ?? [])]);
  };

  const total = staged.reduce((sum, s) => sum + s.file.size, 0);
  const fileProblem = (file: File) =>
    !info
      ? ""
      : file.size === 0
        ? "Empty file"
        : file.size > info.max_file_bytes
          ? `Larger than ${formatBytes(info.max_file_bytes)}`
          : "";
  const problems: string[] = [];
  if (info) {
    if (staged.length > info.max_files)
      problems.push(
        `This link takes at most ${fileCount(info.max_files)}. Remove ${fileCount(staged.length - info.max_files)}.`,
      );
    if (staged.some((s) => fileProblem(s.file)))
      problems.push("Remove the files marked below before sending.");
    if (total > info.max_request_bytes)
      problems.push(
        `All files together must be at most ${formatBytes(info.max_request_bytes)}.`,
      );
  }
  const canSend = open && staged.length > 0 && !problems.length && wait === 0;

  const send = async () => {
    if (!canSend) return;
    const files = staged.map((s) => s.file);
    setError("");
    setFailures([]);
    setPhase({ kind: "sending", loaded: 0, total: 0 });
    try {
      const outcome = await uploadLinkApi.send(token, files, (loaded, all) =>
        setPhase({ kind: "sending", loaded, total: all }),
      );
      clearStaged();
      setPhase({ kind: "done", outcome, names: files.map((f) => f.name) });
    } catch (raw) {
      const e =
        raw instanceof UploadLinkError
          ? raw
          : new UploadLinkError("Network error");
      if (e.status === 404 || e.status === 410) {
        clearStaged();
        setPhase({ kind: "gone", maybeSent: networkFailed.current });
        return;
      }
      setPhase({ kind: "ready" });
      if (e.status === 0) {
        networkFailed.current = true;
        setError(
          "Network error: the files may not have arrived. Check your connection and send again.",
        );
      } else if (e.status === 429) {
        setWait(e.retryAfter || 5);
        setError("Too many upload requests right now.");
      } else if (e.status === 503) {
        setWait(e.retryAfter || 5);
        setError("Another upload is in progress right now.");
      } else if (e.status === 413) {
        setError("These files are too large to send together. Remove some.");
      } else if (e.results.length) {
        setFailures(e.results.filter((r) => !r.ok));
        setError(
          "No file was added. Fix or remove the files below and send again.",
        );
      } else {
        setError(e.message || `The upload failed (HTTP ${e.status}).`);
      }
    }
  };

  const kind = info?.parent_kind === "note" ? "note" : "task";
  const failureFor = (index: number) =>
    failures.find((f) => f.index === index)?.error?.message;

  return (
    <main
      className={`upload-shell${dragging ? " upload-dragging" : ""}`}
      onDragOver={(e) => {
        if (!open) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={drop}
    >
      <section className="upload-card" aria-labelledby="upload-title">
        <div className="upload-brand">
          <Brand />
          <strong>Crew</strong>
        </div>
        {phase.kind === "loading" && !error && (
          <p role="status">Opening the upload link…</p>
        )}
        {phase.kind === "loading" && error && (
          <>
            <h1 id="upload-title">Add screenshots</h1>
            <p role="alert" className="upload-error">
              {error}
              {wait > 0 && ` Try again in ${wait} seconds.`}
            </p>
            <button
              className="primary-button"
              disabled={wait > 0}
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </>
        )}
        {phase.kind === "gone" && (
          <>
            <h1 id="upload-title">Upload link unavailable</h1>
            <p role="alert" className="upload-error">
              {goneMessage}
            </p>
            {phase.maybeSent && (
              <p>
                If your earlier send finished before the connection dropped, its
                files were added. Ask the person who shared the link to check.
              </p>
            )}
          </>
        )}
        {phase.kind === "done" && info && (
          <>
            <h1 id="upload-title">
              {phase.outcome.added === phase.names.length
                ? "Done"
                : "Partly done"}
            </h1>
            <p role="status">
              {fileCount(phase.outcome.added)} added to the {kind}{" "}
              <strong>{info.title}</strong>.
            </p>
            <ul className="upload-results" aria-label="Upload results">
              {phase.names.map((name, i) => {
                const result = phase.outcome.results.find(
                  (r) => r.index === i + 1,
                );
                const ok = result ? result.ok : false;
                return (
                  <li key={i} className={ok ? "upload-ok" : "upload-failed"}>
                    <span className="upload-name">{name}</span>
                    <span>
                      {ok ? "Saved" : result?.error?.message || "Not added"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p>This link is now used. You can close this page.</p>
          </>
        )}
        {(phase.kind === "ready" || phase.kind === "sending") && info && (
          <>
            <h1 id="upload-title">
              Add screenshots to: <span>{info.title}</span>
            </h1>
            <p className="upload-meta">
              {kind === "note" ? "Note" : "Task"} · expires{" "}
              {timeText(info.expires_at)}
              <br />
              Up to {fileCount(info.max_files)},{" "}
              {formatBytes(info.max_file_bytes)} each,{" "}
              {formatBytes(info.max_request_bytes)} in total. Any file type.
            </p>
            <div className="upload-drop">
              <input
                ref={input}
                id="upload-input"
                type="file"
                multiple
                className="upload-input"
                onChange={choose}
                disabled={phase.kind === "sending"}
              />
              <label htmlFor="upload-input" className="upload-choose">
                Choose photos or files
              </label>
              <p className="upload-hint">
                You can also paste or drag files here.
              </p>
            </div>
            {staged.length > 0 && (
              <ul className="upload-staged" aria-label="Files to send">
                {staged.map((s, i) => {
                  const problem =
                    fileProblem(s.file) || failureFor(i + 1) || "";
                  return (
                    <li key={s.key} className={problem ? "upload-bad" : ""}>
                      {s.preview ? (
                        <img src={s.preview} alt="" width="48" height="48" />
                      ) : (
                        <span className="upload-icon" aria-hidden="true">
                          {(s.file.name.split(".").pop() || "file")
                            .slice(0, 4)
                            .toUpperCase()}
                        </span>
                      )}
                      <span className="upload-file">
                        <span className="upload-name">{s.file.name}</span>
                        <small>
                          {formatBytes(s.file.size)}
                          {problem && (
                            <span className="upload-problem"> · {problem}</span>
                          )}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="upload-remove"
                        aria-label={`Remove ${s.file.name}`}
                        disabled={phase.kind === "sending"}
                        onClick={() => remove(s.key)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {staged.length > 0 && (
              <p className="upload-total">
                {fileCount(staged.length)}, {formatBytes(total)}
              </p>
            )}
            {problems.map((p) => (
              <p key={p} role="alert" className="upload-error">
                {p}
              </p>
            ))}
            {error && (
              <p role="alert" className="upload-error">
                {error}
                {wait > 0 && ` Try again in ${wait} seconds.`}
              </p>
            )}
            {phase.kind === "sending" && (
              <div className="upload-progress" role="status">
                <progress
                  aria-label="Upload progress"
                  max={phase.total || 1}
                  value={phase.total ? phase.loaded : undefined}
                />
                <span>
                  Sending
                  {phase.total
                    ? ` ${Math.round((phase.loaded / phase.total) * 100)}%`
                    : "…"}
                </span>
              </div>
            )}
            <button
              type="button"
              className="primary-button upload-send"
              disabled={!canSend}
              onClick={() => void send()}
            >
              {phase.kind === "sending"
                ? "Sending…"
                : staged.length
                  ? `Send ${fileCount(staged.length)}`
                  : "Send"}
            </button>
            <p className="upload-note">
              The link works for one send. Files are added to this {kind} only;
              nothing else in Crew is visible here.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
