// Attachments, one-time upload links and the instance storage limit.
// Operation helpers run inside the caller's write transaction; the public
// upload-link routes open their own. File bytes are inspected in Go
// ($pocketcontext.crewAttachmentFiles); nothing here sniffs or serves bytes.
const webhooks = require(`${__hooks}/crew_webhooks.js`);
const execution = require(`${__hooks}/crew_execution.js`);
const MAX_ACTIVE = 20;
const MAX_FILE_BYTES = 20971520;
const MAX_REQUEST_BYTES = 105906176; // route body limit (101 MiB)
const DEFAULT_STORAGE_LIMIT = 5368709120;
const MIN_STORAGE_LIMIT = 1048576;
const MAX_STORAGE_LIMIT = 1099511627776;
const MAX_FAILED_UPLOADS = 5;
const ID = /^[a-z0-9]{15}$/;
const TOKEN = /^[A-Za-z0-9]{43}$/;
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const collections = ["attachments", "upload_links", "settings"];
const FILE_ACTIONS = ["attachment.add", "task.create", "note.create"];
const ACTIONS = [
  "attachment.add",
  "attachment.archive",
  "attachment.restore",
  "upload_link.create",
  "upload_link.revoke",
  "storage.update",
];
const TEXT_FIELDS = { task: ["description", "draft"], note: ["body"] };
// Attachment references and data: images are found on a parsed CommonMark
// (GFM) tree in Go ($pocketcontext.crewMarkdownRefs), with the reader's
// semantics: link and image destinations, reference definitions anywhere and
// autolinks, after decoding backslash escapes and character references, with
// a case-insensitive scheme. Prose such as "attachment: see below" is not a
// destination. Raw HTML is never rendered by the reader; an <img> data: URL is
// still refused.
const HTML_DATA_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*data:/i;
const PLACEHOLDER = /attachment:new-(\d+)/g;

function bad(message) {
  throw new BadRequestError(message);
}
function only(o, allowed) {
  for (const k of Object.keys(o || {}))
    if (!allowed.includes(k)) bad("Unsupported field: " + k);
}
function get(app, collection, id) {
  if (typeof id !== "string" || !ID.test(id))
    throw new NotFoundError("Record not found");
  return app.findRecordById(collection, id);
}
function check(r, b) {
  if (
    !Number.isInteger(b.expected_revision) ||
    b.expected_revision !== r.getInt("revision")
  )
    throw new ApiError(409, "Revision conflict; reread and reassess", {});
}
function mib(bytes) {
  return Math.round((bytes / 1048576) * 10) / 10 + " MiB";
}
// Per-file failures as one 400: data["files.N"] carries code and message.
function failFiles(message, results) {
  const data = {};
  for (const r of results)
    if (!r.ok)
      data["files." + r.index] = new ValidationError(
        r.error.code,
        r.error.message,
      );
  throw new ApiError(400, message, data);
}
function failure(f, code, message) {
  return {
    index: f.index,
    name: f.name || "",
    ok: false,
    error: { code, message },
  };
}

function settings(app) {
  return app.findFirstRecordByFilter("crew_settings", "singleton='settings'");
}
function storageLimit(app) {
  return settings(app).getInt("storage_limit_bytes") || DEFAULT_STORAGE_LIMIT;
}
// Archived attachments count: bytes are never purged.
function storageUsed(app) {
  const row = new DynamicModel({ total: 0 });
  app
    .db()
    .newQuery("SELECT COALESCE(SUM(size),0) AS total FROM crew_attachments")
    .one(row);
  return row.total;
}
function active(app, parent) {
  return app.findRecordsByFilter(
    "crew_attachments",
    "parent={:p} && archived=false",
    "position",
    0,
    0,
    { p: parent },
  );
}
function nextPosition(app, parent) {
  const row = new DynamicModel({ position: 0 });
  app
    .db()
    .newQuery(
      "SELECT COALESCE(MAX(position),0) AS position FROM crew_attachments WHERE parent={:p}",
    )
    .bind({ p: parent })
    .one(row);
  return row.position + 1;
}
function parentRecord(app, kind, id) {
  return get(app, kind === "task" ? "crew_tasks" : "crew_notes", id);
}
function parentOf(app, d) {
  if ((d.task === undefined) === (d.note === undefined))
    bad("Name exactly one of task or note");
  const kind = d.task !== undefined ? "task" : "note";
  return { kind, record: parentRecord(app, kind, d[kind]) };
}
function parentActive(app, kind, r) {
  if (r.getBool("archived")) return false;
  if (kind === "note")
    return !app
      .findRecordById("crew_buckets", r.getString("bucket"))
      .getBool("archived");
  return true;
}
function requireActiveParent(app, kind, r) {
  if (!parentActive(app, kind, r))
    bad(
      kind === "note" && !r.getBool("archived")
        ? "Restore the bucket first"
        : "Restore the " + kind + " first",
    );
}
function audit(app, parent, action, ctx, changes) {
  const ev = new Record(app.findCollectionByNameOrId("crew_events"));
  ev.set("parent", parent);
  ev.set("action", action);
  ev.set("body", "");
  ev.set("actor", ctx.actor);
  ev.set("reported_agent", ctx.b.reported_agent || "");
  ev.set("reason", ctx.b.reason || "");
  ev.set("changes", changes);
  ev.set("revision", 1);
  app.save(ev);
}
function describe(r) {
  const out = {
    attachment: r.id,
    name: r.getString("name"),
    size: r.getInt("size"),
    media_type: r.getString("media_type"),
    image: r.getBool("image"),
    sha256: r.getString("sha256"),
  };
  if (r.getString("via_upload_link"))
    out.via_upload_link = r.getString("via_upload_link");
  return out;
}

// Gathers files for FILE_ACTIONS from multipart parts named "files" or from
// data.files [{name, content_base64}] (removed from data). Other actions
// refuse files. Returns inspected entries in request order.
function collect(e, b) {
  const d = b.data;
  let list = [];
  if (d && typeof d === "object" && d.files !== undefined) {
    if (!FILE_ACTIONS.includes(b.action))
      bad(
        "Files are accepted only by attachment.add, task.create and note.create",
      );
    if (!Array.isArray(d.files))
      bad("data.files must be an array of {name, content_base64}");
    list = d.files;
    delete d.files;
  }
  const result = $pocketcontext.crewAttachmentFiles(e, list);
  if (result.error) bad(result.error);
  if (result.files.length && !FILE_ACTIONS.includes(b.action))
    bad(
      "Files are accepted only by attachment.add, task.create and note.create",
    );
  return result.files;
}
// The fingerprint of a file-carrying request names files by digest, so a
// replay with the same files matches and changed files conflict.
function digests(files) {
  return files.map((f) => ({
    name: f.name || "",
    sha256: f.sha256 || "",
    size: f.size || 0,
    error: f.error_code || "",
  }));
}
function idempotentFiles(app, b, files, fn) {
  if (!b.idempotency_key) return fn();
  return webhooks.idempotent(
    app,
    { ...b, data: { ...(b.data || {}), files: digests(files) } },
    fn,
  );
}

// Saves valid files in order; each file succeeds or fails on its own.
function addFiles(app, kind, parent, files, ctx) {
  const results = [],
    saved = [];
  let count = active(app, parent.id).length,
    used = storageUsed(app),
    position = nextPosition(app, parent.id);
  const limit = storageLimit(app);
  for (const f of files) {
    if (f.error_code) {
      results.push(failure(f, f.error_code, f.error_message));
      continue;
    }
    if (count >= MAX_ACTIVE) {
      results.push(
        failure(
          f,
          "attachment_limit",
          "A " +
            kind +
            " holds at most 20 active attachments; archive one first",
        ),
      );
      continue;
    }
    if (used + f.size > limit) {
      results.push(
        failure(
          f,
          "storage_limit",
          "Storage limit reached (" +
            mib(used) +
            " of " +
            mib(limit) +
            " used); the owner can raise it in Settings",
        ),
      );
      continue;
    }
    const r = new Record(app.findCollectionByNameOrId("crew_attachments"));
    r.set("parent_kind", kind);
    r.set("parent", parent.id);
    r.set("file", f.file);
    r.set("name", f.name);
    r.set("media_type", f.media_type);
    r.set("image", f.image);
    r.set("width", f.width);
    r.set("height", f.height);
    r.set("size", f.size);
    r.set("sha256", f.sha256);
    r.set("position", position++);
    r.set("actor", ctx.actor);
    r.set("reported_agent", ctx.b.reported_agent || "");
    r.set("via_upload_link", ctx.link ? ctx.link.id : "");
    r.set("revision", 1);
    app.save(r);
    count++;
    used += f.size;
    saved.push(r);
    results.push({ index: f.index, name: f.name, ok: true, id: r.id });
  }
  return { saved, results };
}

// An attachment change on a task withdraws its pending review exactly like a
// draft edit: Waiting, status back to In progress, a new wake generation and
// no wake. Without a pending review the task record is untouched.
function withdrawForChange(app, kind, t, ctx, h) {
  if (kind !== "task" || !h.pending(app, t.id).length) return false;
  const oldTask = webhooks.state(app, t);
  h.withdraw(app, t, ctx.b, ctx.actor);
  t.set("readiness", "waiting");
  if (t.getString("status") === "needs_review") t.set("status", "in_progress");
  if (ctx.ownerTouch) h.ownerTouch(t);
  t.set("revision", t.getInt("revision") + 1);
  app.save(t);
  webhooks.transition(app, t, oldTask, { autoWithdraw: true });
  execution.invalidateStale(app, t, ctx.b, ctx.actor);
  return true;
}
function recordAdded(app, kind, parent, saved, ctx, h) {
  const withdrawn = withdrawForChange(app, kind, parent, ctx, h);
  for (const r of saved)
    audit(
      app,
      parent.id,
      "attachment.add",
      ctx,
      withdrawn ? { ...describe(r), review_withdrawn: true } : describe(r),
    );
  return withdrawn;
}

function linkState(r) {
  if (r.getString("revoked_at")) return "revoked";
  if (r.getString("used_at")) return "used";
  const expires = Date.parse(r.getString("expires_at"));
  if (!Number.isFinite(expires) || expires <= Date.now()) return "expired";
  return "active";
}
function exported(r, app) {
  const out = r.publicExport();
  const name = r.collection().name;
  if (name === "crew_upload_links") out.state = linkState(r);
  if (name === "crew_settings") {
    out.storage_used_bytes = storageUsed(app);
    out.max_file_bytes = MAX_FILE_BYTES;
    out.max_active_attachments = MAX_ACTIVE;
  }
  return out;
}
function snapshot(app, task) {
  return active(app, task).map((r) => ({
    id: r.id,
    sha256: r.getString("sha256"),
  }));
}
// Approval covers exactly the attachments the review saw. Reviews from before
// attachments existed carry no snapshot.
function snapshotMatches(app, review) {
  const raw = review.getString("attachments");
  if (!raw || raw === "null") return true;
  return (
    JSON.stringify(JSON.parse(raw)) ===
    JSON.stringify(snapshot(app, review.getString("task")))
  );
}

function markdown(text) {
  const parsed = $pocketcontext.crewMarkdownRefs(text || "");
  const refs = [];
  for (let i = 0; i < parsed.refs.length; i++) refs.push(String(parsed.refs[i]));
  return { refs, dataImage: !!parsed.data_image };
}
function refs(text) {
  return markdown(text).refs;
}
// New references must name active attachments of this task or note. A
// reference already saved in the same field may stay after its attachment is
// archived (the reader shows "removed"); note.restore may bring back the
// note's own archived references.
function checkRefs(app, kind, r, values, op) {
  const fields = TEXT_FIELDS[kind];
  for (const f of fields) {
    if (typeof values[f] !== "string") continue;
    const text = values[f];
    const before = {};
    if (op !== "create")
      for (const id of refs(r.getString(f))) before[id] = true;
    const parsed = markdown(text);
    if (parsed.dataImage || HTML_DATA_IMAGE.test(text))
      bad(
        f +
          " embeds a data: image; attach the file and reference it as ![alt](attachment:ID)",
      );
    for (const ref of parsed.refs) {
      if (/^new-\d+$/i.test(ref))
        bad(
          "attachment:" +
            ref +
            " placeholders work only in task.create or note.create with files",
        );
      let a = null;
      if (ID.test(ref))
        try {
          a = app.findRecordById("crew_attachments", ref);
        } catch (_) {
          a = null;
        }
      if (!a) bad("Unknown attachment reference attachment:" + ref);
      if (a.getString("parent") !== r.id)
        bad(
          "attachment:" +
            ref +
            " belongs to another task or note; attach the file here first",
        );
      if (a.getBool("archived") && !before[ref] && op !== "restore")
        bad(
          "attachment:" +
            ref +
            " is archived; restore it before referencing it",
        );
    }
  }
}

// task.create / note.create with files: every file must pass, the record id
// is fixed first, attachments are saved, and attachment:new-N placeholders
// (N = 1-based file position in the request) become real IDs before the
// record's own validation and save. Any failure rolls back the whole create.
function stageCreate(app, kind, r, values, files, ctx) {
  if (files.some((f) => f.error_code))
    failFiles(
      "No " + kind + " was created: a file was refused",
      files.map((f) =>
        f.error_code
          ? failure(f, f.error_code, f.error_message)
          : { index: f.index, name: f.name, ok: true },
      ),
    );
  r.set(
    "id",
    $security.randomStringWithAlphabet(
      15,
      "abcdefghijklmnopqrstuvwxyz0123456789",
    ),
  );
  const out = addFiles(app, kind, r, files, ctx);
  if (out.saved.length !== files.length)
    failFiles("No " + kind + " was created: a file was refused", out.results);
  const ids = out.saved.map((x) => x.id);
  for (const f of TEXT_FIELDS[kind])
    if (typeof values[f] === "string")
      values[f] = values[f].replace(PLACEHOLDER, (all, n) => {
        const i = Number(n);
        if (!Number.isInteger(i) || i < 1 || i > ids.length)
          bad(
            all + " does not match an uploaded file (1 to " + ids.length + ")",
          );
        return "attachment:" + ids[i - 1];
      });
  return out.saved;
}
function recordCreated(app, kind, r, saved, ctx) {
  for (const a of saved) audit(app, r.id, "attachment.add", ctx, describe(a));
}

function handle(app, e, b, actor, isAgent, files, h) {
  const d = b.data || {};
  const ctx = { b, actor, isAgent, ownerTouch: !isAgent, link: null };
  if (b.action === "attachment.add") {
    only(d, ["task", "note"]);
    if (!files.length)
      bad("Add at least one file (multipart parts named files, or data.files)");
    const p = parentOf(app, d);
    requireActiveParent(app, p.kind, p.record);
    if (p.kind === "task") execution.guardTaskWrite(app, p.record, b, isAgent);
    return idempotentFiles(app, b, files, () => {
      const out = addFiles(app, p.kind, p.record, files, ctx);
      if (!out.saved.length) failFiles("No file was attached", out.results);
      const withdrawn = recordAdded(app, p.kind, p.record, out.saved, ctx, h);
      return {
        attachments: out.saved.map((r) => r.publicExport()),
        results: out.results,
        review_withdrawn: withdrawn,
      };
    });
  }
  if (b.action === "attachment.archive" || b.action === "attachment.restore") {
    only(d, []);
    const r = get(app, "crew_attachments", b.id);
    const kind = r.getString("parent_kind");
    const parent = parentRecord(app, kind, r.getString("parent"));
    requireActiveParent(app, kind, parent);
    if (kind === "task") execution.guardTaskWrite(app, parent, b, isAgent);
    // Revision checks run inside the idempotent step so a retry replays.
    return webhooks.idempotent(app, b, () => {
      check(r, b);
      const archive = b.action === "attachment.archive";
      if (archive === r.getBool("archived"))
        bad(
          archive
            ? "Attachment is already archived"
            : "Attachment is not archived",
        );
      if (!archive && active(app, parent.id).length >= MAX_ACTIVE)
        bad(
          "A " +
            kind +
            " holds at most 20 active attachments; archive one first",
        );
      r.set("archived", archive);
      r.set("archived_at", archive ? new Date().toISOString() : "");
      r.set("archived_by", archive ? actor : "");
      r.set("revision", r.getInt("revision") + 1);
      app.save(r);
      const withdrawn = withdrawForChange(app, kind, parent, ctx, h);
      const changes = { attachment: r.id, name: r.getString("name") };
      if (withdrawn) changes.review_withdrawn = true;
      audit(app, parent.id, b.action, ctx, changes);
      return { ...r.publicExport(), review_withdrawn: withdrawn };
    });
  }
  if (b.action === "upload_link.create") {
    // write() refuses work clients before this point (owner browser only).
    if (b.idempotency_key)
      bad(
        "upload_link.create does not take idempotency_key; its token is shown once",
      );
    only(d, ["task", "note", "expires_in_minutes", "max_files"]);
    const p = parentOf(app, d);
    requireActiveParent(app, p.kind, p.record);
    const minutes =
      d.expires_in_minutes === undefined ? 15 : d.expires_in_minutes;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      bad("expires_in_minutes must be an integer from 1 to 1440");
    const maxFiles = d.max_files === undefined ? 10 : d.max_files;
    if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_ACTIVE)
      bad("max_files must be an integer from 1 to 20");
    const token = $security.randomStringWithAlphabet(43, ALNUM);
    const r = new Record(app.findCollectionByNameOrId("crew_upload_links"));
    r.set("parent_kind", p.kind);
    r.set("parent", p.record.id);
    r.set("token_hash", $security.sha256(token));
    r.set("created_by", actor);
    r.set("expires_at", new Date(Date.now() + minutes * 60000).toISOString());
    r.set("max_files", maxFiles);
    r.set("files_added", 0);
    r.set("failed_uploads", 0);
    r.set("revision", 1);
    app.save(r);
    audit(app, p.record.id, b.action, ctx, {
      upload_link: r.id,
      expires_at: r.getString("expires_at"),
      max_files: maxFiles,
    });
    const out = exported(r, app);
    out.token = token;
    out.path = "#/upload/" + token;
    const base = $pocketcontext.webhookBaseURL(app);
    if (base) out.url = base + "/" + out.path;
    return out;
  }
  if (b.action === "upload_link.revoke") {
    only(d, []);
    const r = get(app, "crew_upload_links", b.id);
    return webhooks.idempotent(app, b, () => {
      check(r, b);
      if (r.getString("revoked_at")) bad("Upload link is already revoked");
      r.set("revoked_at", new Date().toISOString());
      r.set("revoked_by", actor);
      r.set("revision", r.getInt("revision") + 1);
      app.save(r);
      audit(app, r.getString("parent"), b.action, ctx, { upload_link: r.id });
      return exported(r, app);
    });
  }
  if (b.action === "storage.update") {
    only(d, ["storage_limit_bytes"]);
    const s = get(app, "crew_settings", b.id);
    const value = d.storage_limit_bytes;
    if (
      !Number.isInteger(value) ||
      value < MIN_STORAGE_LIMIT ||
      value > MAX_STORAGE_LIMIT
    )
      bad(
        "storage_limit_bytes must be an integer from 1048576 (1 MiB) to 1099511627776 (1 TiB)",
      );
    return webhooks.idempotent(app, b, () => {
      check(s, b);
      const old = s.getInt("storage_limit_bytes");
      s.set("storage_limit_bytes", value);
      s.set("revision", s.getInt("revision") + 1);
      app.save(s);
      audit(app, s.id, b.action, ctx, {
        storage_limit_bytes: { old, new: value },
      });
      return exported(s, app);
    });
  }
  bad("Unknown action");
}

// --- Public upload-link endpoints (no sign-in; token-scoped, upload only) ---

// Rate limits, the multipart-only rule, the in-flight cap and body limits run
// in Go before these handlers (uploadLinkGuard in crew_attachments.go).
// The token arrives in the X-Crew-Upload-Token header, never in the URL.
function tokenOf(e) {
  return String(e.request.header.get("X-Crew-Upload-Token") || "");
}
function findLink(app, token) {
  if (typeof token !== "string" || !TOKEN.test(token))
    throw new NotFoundError("Upload link not found");
  const rows = app.findRecordsByFilter(
    "crew_upload_links",
    "token_hash={:h}",
    "",
    1,
    0,
    { h: $security.sha256(token) },
  );
  if (!rows.length) throw new NotFoundError("Upload link not found");
  const link = rows[0],
    state = linkState(link);
  if (state !== "active")
    throw new ApiError(
      410,
      {
        used: "This upload link was already used",
        revoked: "This upload link was revoked",
        expired: "This upload link has expired",
      }[state],
      {},
    );
  const parent = parentRecord(
    app,
    link.getString("parent_kind"),
    link.getString("parent"),
  );
  if (!parentActive(app, link.getString("parent_kind"), parent))
    throw new ApiError(410, "This upload link no longer accepts files", {});
  return { link, parent };
}
// POST /api/crew/upload-link/info: only what the upload page shows.
function uploadInfo(e) {
  const found = findLink(e.app, tokenOf(e));
  return e.json(200, {
    parent_kind: found.link.getString("parent_kind"),
    title: found.parent.getString("title"),
    expires_at: found.link.getString("expires_at"),
    max_files: found.link.getInt("max_files"),
    max_file_bytes: MAX_FILE_BYTES,
    max_request_bytes: MAX_REQUEST_BYTES - 1048576,
  });
}
// POST /api/crew/upload-link/upload, multipart file parts named files. One
// batch: the first request that attaches at least one file uses the link up.
// Requests where every file fails do not use it; five such requests revoke it.
function uploadFiles(e, h) {
  const token = tokenOf(e);
  // Refuse unknown, used, expired and revoked links before reading the body
  // or inspecting any file, and hash files outside the write transaction so a
  // large batch never holds the database writer. The transaction checks the
  // link again: of simultaneous batches only the first to commit uses it.
  const max = findLink(e.app, token).link.getInt("max_files");
  const files = $pocketcontext.crewUploadLinkFiles(e);
  if (files.error) bad(files.error);
  if (!files.files.length) bad("Add at least one file");
  if (files.files.length > max)
    bad("This link accepts at most " + max + " files");
  let status = 200,
    body = null;
  e.app.runInTransaction((app) => {
    const found = findLink(app, token),
      link = found.link;
    if (files.files.length > link.getInt("max_files"))
      bad("This link accepts at most " + link.getInt("max_files") + " files");
    const kind = link.getString("parent_kind");
    const ctx = {
      b: { reported_agent: "", reason: "via upload link " + link.id, data: {} },
      actor: "upload_link:" + link.id,
      isAgent: false,
      ownerTouch: false,
      link,
    };
    const out = addFiles(app, kind, found.parent, files.files, ctx);
    const results = out.results.map((r) => {
      const x = { index: r.index, name: r.name, ok: r.ok };
      if (r.error) x.error = r.error;
      return x;
    });
    if (!out.saved.length) {
      link.set("failed_uploads", link.getInt("failed_uploads") + 1);
      if (link.getInt("failed_uploads") >= MAX_FAILED_UPLOADS) {
        link.set("revoked_at", new Date().toISOString());
        link.set("revoked_by", "system:failed_uploads");
      }
      link.set("revision", link.getInt("revision") + 1);
      app.save(link);
      status = 400;
      body = { status: 400, message: "No file was added", data: {}, results };
      return;
    }
    recordAdded(app, kind, found.parent, out.saved, ctx, h);
    link.set("files_added", out.saved.length);
    link.set("used_at", new Date().toISOString());
    link.set("revision", link.getInt("revision") + 1);
    app.save(link);
    body = { added: out.saved.length, results };
  });
  return e.json(status, body);
}

module.exports = {
  ACTIONS,
  collections,
  collect,
  handle,
  exported,
  snapshot,
  snapshotMatches,
  checkRefs,
  stageCreate,
  recordCreated,
  uploadInfo,
  uploadFiles,
};
