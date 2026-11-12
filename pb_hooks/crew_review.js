// Review evidence and choices are validated before an immutable snapshot is made.
const attachments = require(`${__hooks}/crew_attachments.js`);
function bad(message) {
  throw new BadRequestError(message);
}
function only(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    bad("Invalid review option fields");
}
function localFilePaths(text) {
  // Remove web URLs before looking for absolute Unix, home, Windows and file URLs.
  const clean = text.replace(/https?:\/\/[^\s<>"'`]+/gi, "");
  const pattern =
    /(?:^|[\s(<\["'`])((?:file:\/\/|[A-Za-z]:[\\/]|\\\\|~\/|\.{1,2}[\\/]|\/)[^\n\r<>"'`]*?\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|heic|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|mp[34]|wav|ogg|mov|webm))(?=$|[\s)\]>"'`,;:!?.])/gi;
  return [...new Set(Array.from(clean.matchAll(pattern), (m) => m[1]))];
}
function options(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 20)
    bad("options must be an array of at most 20 choices");
  const keys = new Set();
  let total = 0;
  return input.map((o) => {
    only(o, ["key", "label", "body"]);
    if (
      typeof o.key !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(o.key) ||
      keys.has(o.key)
    )
      bad(
        "Option keys must be unique, 1-64 letters, digits, underscores or hyphens",
      );
    if (typeof o.label !== "string" || !o.label.trim() || o.label.length > 200)
      bad("Each option needs a label of at most 200 characters");
    if (typeof o.body !== "string" || !o.body.trim() || o.body.length > 100000)
      bad("Each option needs a body of at most 100000 characters");
    total += o.body.length;
    if (total > 200000) bad("Option bodies exceed 200000 characters");
    keys.add(o.key);
    return { key: o.key, label: o.label.trim(), body: o.body };
  });
}
function evidence(app, task, draft, choices) {
  const texts = [draft, ...choices.map((o) => o.body)];
  const paths = [...new Set(texts.flatMap(localFilePaths))];
  if (paths.length)
    throw new ApiError(
      400,
      "Attach the referenced files to Crew and use attachment:ID before requesting review",
      {
        reason: new ValidationError(
          "draft_references_unattached_files",
          "Attach files first: " + paths.join(", "),
        ),
        paths: paths,
      },
    );
  for (const text of texts) {
    // Treat every reference as new: an archived reference is not review evidence.
    attachments.checkRefs(app, "task", task, { draft: text }, "create");
  }
}
function decisions(choices, input, overall) {
  if (input === undefined) {
    if (choices.length && overall === "approved")
      bad("Decide every option before approving");
    return overall === "rejected"
      ? choices.map((o) => ({ key: o.key, decision: "rejected", note: "" }))
      : [];
  }
  if (!Array.isArray(input) || input.length > 20)
    bad("option_decisions must be an array of at most 20 choices");
  const keys = new Set(choices.map((o) => o.key));
  const seen = new Set();
  const values = input.map((d) => {
    only(d, ["key", "decision", "note"]);
    if (!keys.has(d.key) || seen.has(d.key))
      bad("Unknown or duplicate option decision key");
    if (!["approved", "rejected"].includes(d.decision))
      bad("Option decision must be approved or rejected");
    if (
      d.note !== undefined &&
      (typeof d.note !== "string" || d.note.length > 20000)
    )
      bad("Option note must be text of at most 20000 characters");
    seen.add(d.key);
    return { key: d.key, decision: d.decision, note: d.note || "" };
  });
  if (
    choices.length &&
    overall === "approved" &&
    (values.length !== choices.length ||
      !values.some((d) => d.decision === "approved"))
  )
    bad(
      "Approval requires a decision for every option and at least one approved option",
    );
  if (
    overall === "rejected" &&
    (values.length !== choices.length ||
      values.some((d) => d.decision !== "rejected"))
  )
    bad("Reject requires every option to be rejected");
  return values;
}
module.exports = { options, evidence, decisions, localFilePaths };
