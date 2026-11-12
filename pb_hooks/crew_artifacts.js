// Artifacts (0.21.0): frozen pages published from notes at /a/<token>.
// Every client creates and edits drafts (artifact.create, artifact.update),
// including drafts that update another artifact's link (replaces, 0.22.0).
// Publishing, replacing the published content, revoking, expiry, archiving
// and restoring are owner-browser only: write() refuses them on the
// work-client route before idempotency, so a bot drafts and the owner
// publishes. A published link may expire (expires_at); an expired token never
// works again, and publishing again issues a new one. The token is a hidden field; only the
// owner's publish/replace results and the owner-only link list return it.
// The public page itself is served in Go (crew_artifacts.go).
const webhooks = require(`${__hooks}/crew_webhooks.js`);
const attachments = require(`${__hooks}/crew_attachments.js`);
const ID = /^[a-z0-9]{15}$/;
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// 32 base62 characters: about 190 bits, never derived from the id.
const TOKEN_LENGTH = 32;
const MAX_SOURCES = 50;
const MAX_TITLE = 300;
const MAX_BODY = 200000;
const collections = ["artifacts"];
const ACTIONS = [
  "artifact.create",
  "artifact.update",
  "artifact.publish",
  "artifact.replace",
  "artifact.revoke",
  "artifact.set_expiry",
  "artifact.archive",
  "artifact.restore",
];
const OWNER_ACTIONS = [
  "artifact.publish",
  "artifact.replace",
  "artifact.revoke",
  "artifact.set_expiry",
  "artifact.archive",
  "artifact.restore",
];
const OWNER_ONLY_MESSAGE =
  "Publishing, replacing, revoking, expiry, archiving and restoring artifacts happen only in the owner's browser; work clients create and edit drafts";

function bad(message) {
  throw new BadRequestError(message);
}
function only(o, allowed) {
  for (const k of Object.keys(o || {}))
    if (!allowed.includes(k)) bad("Unsupported field: " + k);
}
function get(app, id) {
  if (typeof id !== "string" || !ID.test(id))
    throw new NotFoundError("Artifact not found");
  return app.findRecordById("crew_artifacts", id);
}
function check(r, b) {
  if (
    !Number.isInteger(b.expected_revision) ||
    b.expected_revision !== r.getInt("revision")
  )
    throw new ApiError(409, "Revision conflict; reread and reassess", {});
}
function jsonList(r, field) {
  const raw = r.getString(field);
  if (!raw || raw === "null") return [];
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value : [];
}
function audit(app, r, action, ctx, changes) {
  const ev = new Record(app.findCollectionByNameOrId("crew_events"));
  ev.set("parent", r.id);
  ev.set("action", action);
  ev.set("body", "");
  ev.set("actor", ctx.actor);
  ev.set("reported_agent", ctx.b.reported_agent || "");
  ev.set("reason", ctx.b.reason || "");
  ev.set("changes", changes);
  ev.set("revision", 1);
  app.save(ev);
}
// expired: published, with an expiry time that has passed. The public page
// refuses the token from that moment (crew_artifacts.go); an unreadable
// expiry fails closed.
function expired(r, now) {
  const at = r.getString("expires_at");
  if (r.getString("status") !== "published" || !at) return false;
  const t = Date.parse(at);
  return !Number.isFinite(t) || t <= (now || Date.now());
}
// state: the lifecycle the reader and work clients see. status keeps the
// stored value (draft, published or revoked).
function state(r) {
  if (r.getBool("archived")) return "archived";
  if (expired(r)) return "expired";
  return r.getString("status");
}
// A published artifact whose draft differs from what the link shows has
// pending changes that go live only when the owner replaces the content.
function pendingChanges(r) {
  return (
    state(r) === "published" &&
    (r.getString("title") !== r.getString("published_title") ||
      r.getString("body") !== r.getString("published_body"))
  );
}
function exported(r) {
  const out = r.publicExport();
  delete out.token;
  out.pending_changes = pendingChanges(r);
  out.state = state(r);
  out.expired = out.state === "expired";
  out.path = "#/shared/" + r.id;
  return out;
}
function withLink(app, r) {
  const out = exported(r);
  const token = r.getString("token");
  if (!token || out.state !== "published") return out;
  out.token = token;
  out.link_path = "/a/" + token;
  const base = $pocketcontext.webhookBaseURL(app);
  if (base) out.link = base + out.link_path;
  return out;
}

function title(value) {
  if (typeof value !== "string") bad("title must be a string");
  const t = value.trim();
  if (!t) bad("title is required");
  if (t.length > MAX_TITLE) bad("title is at most 300 characters");
  return t;
}
function body(value) {
  if (typeof value !== "string") bad("body must be a string");
  if (value.length > MAX_BODY) bad("body is at most 200000 characters");
  return value;
}
// Sources are the notes and tasks an artifact was built from, shown only in
// Crew. Each must exist (archived is fine: provenance stays true).
function sources(app, value) {
  if (!Array.isArray(value))
    bad("sources must be an array of note or task IDs");
  if (value.length > MAX_SOURCES) bad("sources holds at most 50 IDs");
  const out = [];
  for (const id of value) {
    if (typeof id !== "string" || !ID.test(id))
      bad("sources must contain note or task IDs");
    if (out.includes(id)) continue;
    let found = false;
    for (const col of ["crew_notes", "crew_tasks"])
      try {
        app.findRecordById(col, id);
        found = true;
        break;
      } catch (_) {}
    if (!found) bad("Unknown source " + id + "; name a note or task ID");
    out.push(id);
  }
  return out;
}
// replaces names the artifact whose link a draft updates: an existing,
// unarchived artifact other than the draft itself, which is not an update
// draft too. Publishing checks again that its link is live.
function replaces(app, r, value) {
  if (value === "" || value === null) return "";
  if (typeof value !== "string" || !ID.test(value))
    bad("replaces must be an artifact ID or empty");
  if (r && r.id === value) bad("An artifact cannot replace itself");
  let target;
  try {
    target = app.findRecordById("crew_artifacts", value);
  } catch (_) {
    bad("Unknown artifact " + value + " in replaces");
  }
  if (target.getBool("archived"))
    bad("replaces names an archived artifact; restore it first");
  if (target.getString("replaces"))
    bad("replaces names an update draft; name the artifact it updates");
  return target.id;
}
// expires_at: a future RFC 3339 time, stored as UTC ISO; empty clears it.
function expiry(value) {
  if (value === "" || value === null) return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    bad("expires_at must be an RFC 3339 time or empty");
  const t = Date.parse(value);
  if (!Number.isFinite(t)) bad("expires_at must be an RFC 3339 time or empty");
  if (t <= Date.now()) bad("expires_at must be in the future");
  return new Date(t).toISOString();
}
function notArchived(r) {
  if (r.getBool("archived"))
    bad("Artifact is archived; restore it before changing it");
}
function archive(r, actor) {
  r.set("archived", true);
  r.set("archived_at", new Date().toISOString());
  r.set("archived_by", actor);
}
// The frozen snapshot an event keeps, so every published version stays in
// history after a replace.
function snapshotOf(r) {
  return {
    published_revision: r.getInt("published_revision"),
    title: r.getString("published_title"),
    body: r.getString("published_body"),
    files: jsonList(r, "published_files"),
  };
}
// Images in an artifact are references to immutable attachments: the
// artifact's own files or any note's or task's images (Share as artifact
// keeps a note's references). Only images can be shown on the public page.
// A new reference must name an active image; one already in the draft may
// stay after archiving until the next publish.
function checkBody(app, r, text, op) {
  const parsed = attachments.markdown(text);
  if (parsed.dataImage || /<img\b[^>]*\bsrc\s*=\s*["']?\s*data:/i.test(text))
    bad(
      "body embeds a data: image; attach the file and reference it as ![alt](attachment:ID)",
    );
  const before = {};
  if (op !== "create")
    for (const id of attachments.markdown(r.getString("body")).refs)
      before[id] = true;
  for (const ref of parsed.refs) {
    if (/^new-\d+$/i.test(ref))
      bad(
        "attachment:" +
          ref +
          " placeholders work only in artifact.create with files",
      );
    const a = attachment(app, ref);
    if (!a.getBool("image"))
      bad(
        "attachment:" +
          ref +
          " is not an image; artifacts show PNG, JPEG, GIF and WebP images only",
      );
    if (a.getBool("archived") && !before[ref])
      bad(
        "attachment:" + ref + " is archived; restore it before referencing it",
      );
  }
}
function attachment(app, ref) {
  let a = null;
  if (ID.test(ref))
    try {
      a = app.findRecordById("crew_attachments", ref);
    } catch (_) {
      a = null;
    }
  if (!a) bad("Unknown attachment reference attachment:" + ref);
  return a;
}
// The published snapshot: title, body and the ordered list of distinct image
// attachments it shows (served as /a/<token>/files/<n>, n from 1).
function snapshot(app, r, ctx) {
  const t = r.getString("title").trim();
  if (!t) bad("Give the artifact a title before publishing");
  const files = [];
  for (const ref of attachments.markdown(r.getString("body")).refs) {
    const a = attachment(app, ref);
    if (!a.getBool("image"))
      bad(
        "attachment:" + ref + " is not an image; remove it before publishing",
      );
    if (a.getBool("archived"))
      bad(
        "attachment:" +
          ref +
          " is archived; restore it or remove the reference before publishing",
      );
    if (!files.includes(a.id)) files.push(a.id);
  }
  r.set("published_title", t);
  r.set("published_body", r.getString("body"));
  r.set("published_files", files);
  r.set("published_at", new Date().toISOString());
  r.set("published_by", ctx.actor);
  r.set("published_revision", r.getInt("published_revision") + 1);
  return files;
}

// Publishing an update draft with mode replace: the draft's title, body and
// sources become the target's draft and its new snapshot under the same
// link (the previous snapshot stays in the target's history), and the update
// draft is archived. expires_at, when given, becomes the link's expiry.
function replaceInto(app, draft, targetId, at, ctx) {
  let target;
  try {
    target = app.findRecordById("crew_artifacts", targetId);
  } catch (_) {
    bad("The artifact this draft updates no longer exists; publish as new");
  }
  if (state(target) !== "published")
    bad(
      "The link this draft updates is no longer live; publish it as a new link",
    );
  const previous = snapshotOf(target);
  target.set("title", draft.getString("title"));
  target.set("body", draft.getString("body"));
  target.set("sources", jsonList(draft, "sources"));
  const files = snapshot(app, target, ctx);
  if (at) target.set("expires_at", at);
  target.set("revision", target.getInt("revision") + 1);
  app.save(target);
  const logged = {
    published_revision: target.getInt("published_revision"),
    files: files.length,
    snapshot: snapshotOf(target),
    previous,
    from: draft.id,
  };
  if (at) logged.expires_at = at;
  audit(app, target, "artifact.replace", ctx, logged);
  archive(draft, ctx.actor);
  draft.set("revision", draft.getInt("revision") + 1);
  app.save(draft);
  audit(app, draft, "artifact.publish", ctx, {
    mode: "replace",
    into: target.id,
  });
  return withLink(app, target);
}

function handle(app, b, actor, isAgent, files) {
  const d = b.data || {};
  const ctx = { b, actor, isAgent };
  if (b.action === "artifact.create") {
    only(d, ["title", "body", "sources", "replaces"]);
    const create = () => {
      const r = new Record(app.findCollectionByNameOrId("crew_artifacts"));
      const values = {
        title: title(d.title),
        body: d.body === undefined ? "" : body(d.body),
        sources: d.sources === undefined ? [] : sources(app, d.sources),
        replaces:
          d.replaces === undefined ? "" : replaces(app, null, d.replaces),
      };
      let saved = [];
      if (files.length)
        saved = attachments.stageCreate(app, "artifact", r, values, files, {
          b,
          actor,
          link: null,
        });
      checkBody(app, r, values.body, "create");
      r.set("title", values.title);
      r.set("body", values.body);
      r.set("sources", values.sources);
      r.set("replaces", values.replaces);
      r.set("status", "draft");
      r.set("published_files", []);
      r.set("published_revision", 0);
      r.set("view_count", 0);
      r.set("created_by_agent", (b.reported_agent || "").trim());
      r.set("actor", actor);
      r.set("revision", 1);
      app.save(r);
      attachments.recordCreated(app, "artifact", r, saved, ctx);
      const logged = {
        title: values.title,
        sources: values.sources,
        files: saved.length,
      };
      if (values.replaces) logged.replaces = values.replaces;
      audit(app, r, b.action, ctx, logged);
      return exported(r);
    };
    return webhooks.idempotent(
      app,
      files.length ? attachments.fingerprint(b, files) : b,
      create,
    );
  }
  if (b.action === "artifact.update") {
    only(d, ["title", "body", "sources", "replaces"]);
    if (!Object.keys(d).length)
      bad("Change at least one of title, body, sources or replaces");
    const r = get(app, b.id);
    return webhooks.idempotent(app, b, () => {
      check(r, b);
      notArchived(r);
      const changes = {};
      if (d.replaces !== undefined) {
        if (r.getString("status") !== "draft")
          bad(
            "Only a draft that was never published can update another artifact's link",
          );
        changes.replaces = replaces(app, r, d.replaces);
      }
      if (d.title !== undefined) changes.title = title(d.title);
      if (d.body !== undefined) {
        changes.body = body(d.body);
        checkBody(app, r, changes.body, "update");
      }
      if (d.sources !== undefined) changes.sources = sources(app, d.sources);
      for (const k of Object.keys(changes)) r.set(k, changes[k]);
      r.set("revision", r.getInt("revision") + 1);
      app.save(r);
      const logged = { ...changes };
      if (logged.body !== undefined) logged.body = "(edited)";
      if (pendingChanges(r)) logged.pending_changes = true;
      audit(app, r, b.action, ctx, logged);
      return exported(r);
    });
  }
  // Owner browser only from here (write() refuses work clients first). No
  // idempotency keys: results carry the token, which must not be stored in
  // the replay table.
  if (b.idempotency_key)
    bad(
      b.action + " does not take idempotency_key; its result carries the link",
    );
  only(
    d,
    b.action === "artifact.publish"
      ? ["expires_at", "mode"]
      : b.action === "artifact.set_expiry"
        ? ["expires_at"]
        : [],
  );
  const r = get(app, b.id);
  check(r, b);
  const status = r.getString("status");
  const current = state(r);
  if (b.action === "artifact.restore") {
    if (current !== "archived")
      bad("Only an archived artifact can be restored");
    r.set("archived", false);
    r.set("archived_at", "");
    r.set("archived_by", "");
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    audit(app, r, b.action, ctx, {});
    return exported(r);
  }
  if (current === "archived")
    bad("Artifact is archived; restore it before changing it");
  if (b.action === "artifact.archive") {
    // Discard a draft, or put away a link that no longer works. A live link
    // is revoked first, so archiving never silently turns a link off.
    if (current === "published")
      bad("Revoke the link before archiving the artifact");
    const logged = { state: current };
    // An expired token is already refused; clear it so it can never return.
    if (r.getString("token")) r.set("token", "");
    archive(r, actor);
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    audit(app, r, b.action, ctx, logged);
    return exported(r);
  }
  if (b.action === "artifact.set_expiry") {
    if (current !== "published")
      bad("Only a live link can get an expiry; publish again for a new link");
    if (d.expires_at === undefined)
      bad("expires_at is required (empty never expires)");
    const at = expiry(d.expires_at);
    r.set("expires_at", at);
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    audit(app, r, b.action, ctx, { expires_at: at });
    return withLink(app, r);
  }
  if (b.action === "artifact.publish") {
    if (current === "published")
      bad("Artifact is already published; use artifact.replace to update it");
    const at = d.expires_at === undefined ? "" : expiry(d.expires_at);
    const target = r.getString("replaces");
    if (d.mode !== undefined && !["replace", "new"].includes(d.mode))
      bad("mode must be replace or new");
    if (d.mode !== undefined && !target)
      bad("mode applies only to a draft that updates another artifact");
    if (target && status === "draft") {
      if (d.mode === undefined)
        bad(
          "This draft updates another artifact: choose mode replace (same link, new content) or new (a new link)",
        );
      if (d.mode === "replace") return replaceInto(app, r, target, at, ctx);
      r.set("replaces", "");
    }
    const previous = r.getInt("published_revision") ? snapshotOf(r) : null;
    const files = snapshot(app, r, ctx);
    // A new link every time the link is turned on: a revoked or expired link
    // stays dead.
    r.set("token", $security.randomStringWithAlphabet(TOKEN_LENGTH, ALNUM));
    r.set("status", "published");
    r.set("expires_at", at);
    r.set("revoked_at", "");
    r.set("revoked_by", "");
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    const logged = {
      published_revision: r.getInt("published_revision"),
      files: files.length,
      snapshot: snapshotOf(r),
    };
    if (previous) logged.previous = previous;
    if (at) logged.expires_at = at;
    if (target) logged.mode = "new";
    audit(app, r, b.action, ctx, logged);
    return withLink(app, r);
  }
  if (b.action === "artifact.replace") {
    if (current === "expired")
      bad("The link has expired; publish again for a new link");
    if (status !== "published")
      bad("Only a published artifact can have its content replaced");
    const previous = snapshotOf(r);
    const files = snapshot(app, r, ctx);
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    audit(app, r, b.action, ctx, {
      published_revision: r.getInt("published_revision"),
      files: files.length,
      snapshot: snapshotOf(r),
      previous,
    });
    return withLink(app, r);
  }
  if (b.action === "artifact.revoke") {
    if (status !== "published") bad("Only a published artifact can be revoked");
    r.set("status", "revoked");
    r.set("token", "");
    r.set("revoked_at", new Date().toISOString());
    r.set("revoked_by", actor);
    r.set("revision", r.getInt("revision") + 1);
    app.save(r);
    audit(app, r, b.action, ctx, {});
    return exported(r);
  }
  bad("Unknown action");
}

// GET /api/crew/artifact-links (owner, signed in; not on the MCP route list):
// the links of every published artifact, for the reader's Shared page.
function links(e) {
  e.response.header().set("Cache-Control", "no-store");
  const rows = e.app.findRecordsByFilter(
    "crew_artifacts",
    "status='published' && token!='' && archived=false",
    "-published_at",
    0,
    0,
  );
  return e.json(200, {
    items: rows
      .filter((r) => !expired(r))
      .map((r) => {
        const out = withLink(e.app, r);
        return {
          id: r.id,
          token: out.token,
          link_path: out.link_path,
          link: out.link || "",
        };
      }),
  });
}

module.exports = {
  collections,
  ACTIONS,
  OWNER_ACTIONS,
  OWNER_ONLY_MESSAGE,
  exported,
  handle,
  links,
  jsonList,
};
