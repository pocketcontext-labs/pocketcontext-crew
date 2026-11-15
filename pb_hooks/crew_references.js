// Batch resolver for record ids written in prose (0.29.0). The reader turns
// bare ids and pasted Crew URLs into links titled with the record they name.
// One request resolves a whole page: read collection "references" with ids.
//
// Only collections the owner reads in the reader are resolved. Webhook,
// execution, upload-link and settings records are never looked up, so their
// ids stay plain text. Results carry a title, the reader path (and url with a
// domain) and state; never bodies, tokens, credentials or fencing handles.

const MAX_IDS = 100;
const ID = /^[a-z0-9]{15}$/;

function bad(m) {
  throw new BadRequestError(m);
}

function byIds(app, collection, ids) {
  if (!ids.length) return [];
  try {
    return app.findRecordsByIds("crew_" + collection, ids);
  } catch (_) {
    return [];
  }
}
function one(app, collection, id) {
  if (!id) return null;
  try {
    return app.findRecordById("crew_" + collection, id);
  } catch (_) {
    return null;
  }
}
function link(app, collection, id, title) {
  return $pocketcontext.crewRecordLink(app, collection, id, title);
}
function withBase(app, path) {
  const base = $pocketcontext.webhookBaseURL(app);
  return base ? base + "/" + path : "";
}
function result(app, id, collection, title, path, extra) {
  const out = { id, collection, title, path };
  const url = withBase(app, path);
  if (url) out.url = url;
  return Object.assign(out, extra || {});
}
function noteArchived(app, n) {
  if (n.getBool("archived")) return true;
  const b = one(app, "buckets", n.getString("bucket"));
  return !!b && b.getBool("archived");
}
// A task or note parent, as {kind, record, path}; anything else is null.
function parentItem(app, id) {
  const t = one(app, "tasks", id);
  if (t)
    return {
      kind: "task",
      record: t,
      title: t.getString("title"),
      path: link(app, "tasks", t.id, t.getString("title")).path,
    };
  const n = one(app, "notes", id);
  if (n)
    return {
      kind: "note",
      record: n,
      title: n.getString("title"),
      path: link(app, "notes", n.id, n.getString("title")).path,
    };
  return null;
}
const plainPath = (path) => path.replace(/\?.*$/, "");

function resolve(app, input) {
  if (!Array.isArray(input)) bad("ids must be an array of record ids");
  if (input.length > MAX_IDS) bad("ids takes at most " + MAX_IDS + " ids");
  const ids = [];
  for (const id of input) {
    if (typeof id !== "string" || !ID.test(id))
      bad("ids must be 15-character record ids");
    if (!ids.includes(id)) ids.push(id);
  }
  const found = {};
  let left = ids.slice();
  const take = (collection, fn) => {
    if (!left.length) return;
    for (const r of byIds(app, collection, left)) {
      const out = fn(r);
      if (out) found[r.id] = out;
    }
    left = left.filter((id) => !found[id]);
  };
  take("tasks", (r) =>
    result(
      app,
      r.id,
      "tasks",
      r.getString("title"),
      link(app, "tasks", r.id, r.getString("title")).path,
      { archived: r.getBool("archived"), state: r.getString("status") },
    ),
  );
  take("notes", (r) =>
    result(
      app,
      r.id,
      "notes",
      r.getString("title"),
      link(app, "notes", r.id, r.getString("title")).path,
      { archived: noteArchived(app, r) },
    ),
  );
  take("reviews", (r) => {
    const t = one(app, "tasks", r.getString("task"));
    return result(
      app,
      r.id,
      "reviews",
      "Review: " + (t ? t.getString("title") : "task"),
      "#/approvals/" + r.id,
      { state: r.getString("status") },
    );
  });
  take("buckets", (r) =>
    result(
      app,
      r.id,
      "buckets",
      r.getString("name"),
      link(app, "buckets", r.id, r.getString("name")).path,
      { archived: r.getBool("archived") },
    ),
  );
  take("agents", (r) =>
    result(
      app,
      r.id,
      "agents",
      r.getString("name"),
      link(app, "agents", r.id, r.getString("name")).path,
      { archived: r.getBool("archived") },
    ),
  );
  // The owner's Shared page entry, never the public link or its token.
  take("artifacts", (r) =>
    result(
      app,
      r.id,
      "artifacts",
      r.getString("title") || r.getString("published_title") || "Artifact",
      "#/shared/" + r.id,
      { archived: r.getBool("archived") },
    ),
  );
  // A file opens in its task's or note's viewer; an artifact's file opens its
  // Shared page entry.
  take("attachments", (r) => {
    const kind = r.getString("parent_kind");
    const parentId = r.getString("parent");
    const extra = { archived: r.getBool("archived"), parent: parentId };
    if (kind === "artifact")
      return one(app, "artifacts", parentId)
        ? result(app, r.id, "attachments", r.getString("name"), "#/shared/" + parentId, extra)
        : null;
    const p = parentItem(app, parentId);
    if (!p) return null;
    return result(
      app,
      r.id,
      "attachments",
      r.getString("name"),
      p.path + "?file=" + r.id,
      extra,
    );
  });
  // Comments open their task's Comments tab at that comment; other activity
  // opens the task's Activity tab, or the note.
  take("events", (r) => {
    const p = parentItem(app, r.getString("parent"));
    if (!p) return null;
    const action = r.getString("action");
    const comment = action === "task.comment" && !!r.getString("body");
    if (p.kind === "task")
      return result(
        app,
        r.id,
        comment ? "comments" : "events",
        (comment ? "Comment on " : "Activity on ") + p.title,
        p.path + (comment ? "?comment=" + r.id : "?tab=activity"),
        { parent: p.record.id },
      );
    return result(app, r.id, "events", "Activity on " + p.title, plainPath(p.path), {
      parent: p.record.id,
    });
  });
  take("note_revisions", (r) => {
    const n = one(app, "notes", r.getString("note"));
    if (!n) return null;
    return result(
      app,
      r.id,
      "note_revisions",
      "Revision " + r.getInt("revision") + " of " + n.getString("title"),
      link(app, "notes", n.id, n.getString("title")).path,
      { parent: n.id },
    );
  });
  take("session_revisions", (r) => {
    const a = one(app, "agents", r.getString("agent"));
    if (!a) return null;
    return result(
      app,
      r.id,
      "session_revisions",
      "Session instructions revision " +
        r.getInt("revision") +
        " for " +
        a.getString("name"),
      link(app, "agents", a.id, a.getString("name")).path,
      { parent: a.id },
    );
  });
  return { items: ids.filter((id) => found[id]).map((id) => found[id]) };
}

module.exports = { resolve, MAX_IDS };
