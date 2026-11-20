// Review markup (0.38.0): a data-only, line-based reader of the v1 container
// directive vocabulary (:::variant, :::copy, :::note). It follows
// remark-directive's container rules (micromark-extension-directive) closely
// enough that the server and the reader agree on what is interpreted; it never
// evaluates anything and stores nothing. Shared fixtures:
// tests/fixtures/review_markup.json.
const CHANNELS = ["linkedin", "x", "email", "whatsapp", "slack", "generic"];
const DEFAULT_LIMITS = { linkedin: 3000, x: 280 };
const NAMES = ["variant", "copy", "note"];
const CODES = [
  "review_markup_unknown_directive",
  "review_markup_invalid_attribute",
  "review_markup_nesting",
  "review_markup_duplicate_channel",
  "review_markup_unclosed",
];
const LABEL_MAX = 80;
const LIMIT_MAX = 100000;

// micromark: unicodePunctuation is \p{P}|\p{S}; whitespace is \s.
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/;
function punct(c) {
  return PUNCT.test(c);
}
function space(c) {
  return SPACE.test(c);
}
function blank(s) {
  return /^[ \t]*$/.test(s);
}

// Fenced code (``` or ~~~, at most three spaces of indentation).
function fenceOpen(line) {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { ch: m[1][0], len: m[1].length };
}
function fenceClose(line, fence) {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return !!m && m[1][0] === fence.ch && m[1].length >= fence.len;
}
// A closing fence: at least as many colons as the opener, nothing else.
function closes(line, size) {
  const m = line.match(/^ {0,3}(:{3,})[ \t]*$/);
  return !!m && m[1].length >= size;
}

// Directive name: no whitespace or punctuation except - and _ after the first
// character, which may not be punctuation; it may not end in - or _.
function readName(cs, i) {
  if (i >= cs.length || space(cs[i]) || punct(cs[i])) return null;
  let j = i + 1;
  while (
    j < cs.length &&
    !space(cs[j]) &&
    !(punct(cs[j]) && cs[j] !== "-" && cs[j] !== "_")
  )
    j++;
  if (cs[j - 1] === "-" || cs[j - 1] === "_") return null;
  return { name: cs.slice(i, j).join(""), end: j };
}
// [label]: balanced brackets with backslash escapes, on one line.
function readLabel(cs, i) {
  let j = i + 1,
    balance = 0,
    size = 0;
  while (j < cs.length) {
    const c = cs[j];
    if (size > 999) return null;
    if (c === "\\" && ["[", "\\", "]"].includes(cs[j + 1])) {
      j += 2;
      size += 2;
      continue;
    }
    if (c === "[" && ++balance > 32) return null;
    if (c === "]") {
      if (!balance) return { label: cs.slice(i + 1, j).join(""), end: j + 1 };
      balance--;
    }
    j++;
    size++;
  }
  return null;
}
// {attributes}: #id, .class, key, key=value, key="value", key='value'.
function readAttributes(cs, i) {
  const attrs = [];
  const inert = (c) => [`"`, "'", "<", "=", ">", "`"].includes(c);
  let j = i + 1;
  for (;;) {
    while (j < cs.length && (cs[j] === " " || cs[j] === "\t")) j++;
    if (j >= cs.length) return null;
    const c = cs[j];
    if (c === "#" || c === ".") {
      let k = j + 1;
      if (
        k >= cs.length ||
        inert(cs[k]) ||
        ["#", ".", "}"].includes(cs[k]) ||
        space(cs[k])
      )
        return null;
      while (
        k < cs.length &&
        !["#", ".", "}"].includes(cs[k]) &&
        !space(cs[k])
      ) {
        if (inert(cs[k])) return null;
        k++;
      }
      attrs.push({ key: c, value: cs.slice(j + 1, k).join("") });
      j = k;
      continue;
    }
    if (space(c) || (punct(c) && c !== "-" && c !== "_")) {
      if (c !== "}") return null;
      return { attrs, end: j + 1 };
    }
    let k = j + 1;
    while (
      k < cs.length &&
      !space(cs[k]) &&
      !(punct(cs[k]) && !["-", ".", ":", "_"].includes(cs[k]))
    )
      k++;
    const key = cs.slice(j, k).join("");
    while (k < cs.length && (cs[k] === " " || cs[k] === "\t")) k++;
    if (cs[k] !== "=") {
      attrs.push({ key, value: "" });
      j = k;
      continue;
    }
    k++;
    while (k < cs.length && (cs[k] === " " || cs[k] === "\t")) k++;
    if (k >= cs.length || ["<", "=", ">", "`", "}"].includes(cs[k]))
      return null;
    if (cs[k] === `"` || cs[k] === "'") {
      const quote = cs[k];
      let q = k + 1;
      while (q < cs.length && cs[q] !== quote) q++;
      if (q >= cs.length) return null;
      attrs.push({ key, value: cs.slice(k + 1, q).join("") });
      q++;
      if (q < cs.length && cs[q] !== "}" && !space(cs[q])) return null;
      j = q;
      continue;
    }
    let q = k;
    while (q < cs.length && cs[q] !== "}" && !space(cs[q])) {
      if (inert(cs[q])) return null;
      q++;
    }
    attrs.push({ key, value: cs.slice(k, q).join("") });
    j = q;
  }
}
// A container opener: 0-3 spaces, 3+ colons, a name, optional [label],
// optional {attributes}, then only whitespace. Anything else is plain text.
function opener(line) {
  const m = line.match(/^ {0,3}(:{3,})/);
  if (!m) return null;
  const cs = Array.from(line);
  const start = Array.from(m[0]).length;
  const named = readName(cs, start);
  if (!named) return null;
  let j = named.end,
    label = null,
    attrs = [];
  if (cs[j] === "[") {
    const l = readLabel(cs, j);
    if (!l) return null;
    label = l.label;
    j = l.end;
  }
  if (cs[j] === "{") {
    const a = readAttributes(cs, j);
    if (!a) return null;
    attrs = a.attrs;
    j = a.end;
  }
  if (!blank(cs.slice(j).join(""))) return null;
  return { size: m[1].length, name: named.name, label, attrs };
}

// Validates one top-level opener against the whitelist. Returns an error
// {code, message} or the interpreted block.
function interpret(o) {
  const invalid = (message) => ({
    code: "review_markup_invalid_attribute",
    message,
  });
  if (!NAMES.includes(o.name))
    return {
      code: "review_markup_unknown_directive",
      message:
        "Unknown directive :::" +
        o.name +
        "; only variant, copy and note are interpreted (this block shows as text)",
    };
  if (o.label !== null)
    return invalid("Directive labels in [brackets] are not supported");
  const seen = {};
  for (const a of o.attrs) {
    if (a.key === "#" || a.key === ".")
      return invalid("#id and .class attributes are not supported");
    if (seen[a.key]) return invalid("Attribute " + a.key + " appears twice");
    seen[a.key] = a.value;
  }
  const keys = Object.keys(seen);
  const allowed = { variant: ["channel", "limit"], copy: ["label"], note: [] }[
    o.name
  ];
  const extra = keys.find((k) => !allowed.includes(k));
  if (extra !== undefined)
    return invalid(
      "Attribute " +
        extra +
        " is not allowed on :::" +
        o.name +
        (allowed.length ? " (allowed: " + allowed.join(", ") + ")" : ""),
    );
  if (o.name === "variant") {
    if (!CHANNELS.includes(seen.channel))
      return invalid(
        seen.channel === undefined
          ? "variant needs channel=" + CHANNELS.join("|")
          : "Unknown channel " +
              seen.channel +
              "; use one of " +
              CHANNELS.join(", "),
      );
    let limit = DEFAULT_LIMITS[seen.channel] || null;
    if (seen.limit !== undefined) {
      if (
        !/^[0-9]{1,6}$/.test(seen.limit) ||
        Number(seen.limit) < 1 ||
        Number(seen.limit) > LIMIT_MAX
      )
        return invalid("limit must be an integer from 1 to " + LIMIT_MAX);
      limit = Number(seen.limit);
    }
    return { kind: "variant", target: seen.channel, limit };
  }
  if (o.name === "copy") {
    const label = seen.label;
    if (
      label === undefined ||
      !label.trim() ||
      Array.from(label).length > LABEL_MAX
    )
      return invalid(
        'copy needs label="..." of 1 to ' + LABEL_MAX + " characters",
      );
    return { kind: "copy", label };
  }
  return { kind: "note", target: "" };
}

function excerpt(line) {
  const cs = Array.from(line.trim());
  return cs.length > 200 ? cs.slice(0, 200).join("") + "…" : cs.join("");
}

// parse(body) -> {blocks: [{kind, target, limit?, label?, line}],
// errors: [{code, line, opener, message}]} with 1-based lines. Blocks are the
// interpreted top-level containers: valid, closed, not containing another
// opener, and not sharing a channel with another variant. Everything else
// renders as its source text.
function parse(body) {
  const lines = String(body || "").split(/\r\n|\r|\n/);
  const errors = [];
  const top = [];
  let stack = [];
  let fence = null;
  const error = (code, entry, message) =>
    errors.push({ code, line: entry.line, opener: entry.opener, message });
  lines.forEach((line, index) => {
    // Every open container checks its closing fence before its content sees
    // the line, outermost first (also inside fenced code).
    const at = stack.findIndex((s) => closes(line, s.size));
    if (at >= 0) {
      for (const s of stack.slice(at)) s.closed = true;
      stack = stack.slice(0, at);
      if (fence && fence.depth > stack.length) fence = null;
      return;
    }
    if (fence) {
      if (fenceClose(line, fence)) fence = null;
      return;
    }
    const f = fenceOpen(line);
    if (f) {
      fence = { ...f, depth: stack.length };
      return;
    }
    const o = opener(line);
    if (!o) return;
    const entry = {
      size: o.size,
      line: index + 1,
      opener: excerpt(line),
      closed: false,
      nested: false,
    };
    if (stack.length) {
      for (const s of stack) s.nested = true;
      error(
        "review_markup_nesting",
        entry,
        "Directives cannot be nested; close the outer block before opening :::" +
          o.name,
      );
    } else {
      entry.result = interpret(o);
      top.push(entry);
    }
    stack.push(entry);
  });
  const blocks = [];
  for (const entry of top) {
    if (entry.result.code)
      error(entry.result.code, entry, entry.result.message);
    else if (!entry.closed)
      error(
        "review_markup_unclosed",
        entry,
        "Add a closing line of at least " +
          entry.size +
          " colons after this block",
      );
    else if (!entry.nested) blocks.push(entry);
  }
  // One variant per channel: every variant of a repeated channel stays text.
  const count = {};
  for (const b of blocks)
    if (b.result.kind === "variant")
      count[b.result.target] = (count[b.result.target] || 0) + 1;
  const seen = {};
  for (const b of blocks)
    if (b.result.kind === "variant" && count[b.result.target] > 1) {
      if (seen[b.result.target])
        error(
          "review_markup_duplicate_channel",
          b,
          "A second variant for channel " +
            b.result.target +
            "; use one variant per channel in each body",
        );
      seen[b.result.target] = true;
    }
  let copies = 0;
  const out = [];
  for (const b of blocks) {
    const r = b.result;
    if (r.kind === "variant" && count[r.target] > 1) continue;
    if (r.kind === "variant")
      out.push({
        kind: "variant",
        target: r.target,
        limit: r.limit,
        line: b.line,
      });
    else if (r.kind === "copy")
      out.push({
        kind: "copy",
        target: "copy-" + ++copies,
        label: r.label,
        line: b.line,
      });
    else out.push({ kind: "note", target: "", line: b.line });
  }
  errors.sort((a, b) => a.line - b.line);
  return { blocks: out, errors };
}
// Feedback targets of a body: variant channels and copy-<n>, never notes.
function targets(body) {
  return parse(body)
    .blocks.filter((b) => b.target)
    .map((b) => b.target);
}
// Write warnings (never blocking): [{code, option, field, line, opener, message}].
function warnings(body, option, field) {
  if (typeof body !== "string" || !body.includes(":::")) return [];
  const { errors, blocks } = parse(body);
  if (field === "description") {
    const lines = body.split(/\r\n|\r|\n/);
    for (const b of blocks) {
      if (b.kind === "note") continue;
      errors.push({
        code: "task_description_contains_draft",
        line: b.line,
        opener: excerpt(lines[b.line - 1]),
        message: "Keep the owner's request in description. Move this paste-ready block to draft or a review option.",
      });
    }
    errors.sort((a, b) => a.line - b.line);
  }
  return errors.map((e) => ({
    code: e.code,
    option: option || "",
    field: field || "",
    line: e.line,
    opener: e.opener,
    message: e.message,
  }));
}
module.exports = {
  parse,
  targets,
  warnings,
  CHANNELS,
  DEFAULT_LIMITS,
  CODES,
  LABEL_MAX,
  LIMIT_MAX,
};
