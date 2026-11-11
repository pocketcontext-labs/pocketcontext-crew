// Only authenticated custom operations can mutate Crew records. Generic REST,
// batch and SQL cannot manufacture approvals or rewrite history.
routerAdd(
  "POST",
  "/api/crew/read",
  (e) => require(`${__hooks}/crew.js`).read(e),
  $apis.requireAuth("users"),
);
// Writes accept JSON, or multipart (an @jsonPayload envelope plus file parts
// named "files") for attachment.add, task.create and note.create. 90 MiB
// covers a batch of files and stays under Cloudflare's 100 MB request limit;
// the public HTTPS listener caps requests at 110 MiB.
routerAdd(
  "POST",
  "/api/crew/write",
  (e) => require(`${__hooks}/crew.js`).write(e, false),
  $apis.requireAuth("users"),
  $apis.bodyLimit(94371840),
);
routerAdd(
  "POST",
  "/api/crew/agent-write",
  (e) => require(`${__hooks}/crew.js`).write(e, true),
  $apis.requireAuth("users"),
  $apis.bodyLimit(94371840),
);
// The only unauthenticated Crew writes: a one-time upload link adds files to
// its one task or note. Token-scoped, upload only, expiring, single batch and
// rate-limited; nothing is readable except the parent title on info. A Go
// router middleware (uploadLinkGuard) runs first: token in the
// X-Crew-Upload-Token header, separate rate buckets for unknown tokens and
// for each link, multipart only and at most two uploads in flight.
routerAdd(
  "POST",
  "/api/crew/upload-link/info",
  (e) => require(`${__hooks}/crew.js`).uploadInfo(e),
  $apis.bodyLimit(4096),
);
routerAdd(
  "POST",
  "/api/crew/upload-link/upload",
  (e) => require(`${__hooks}/crew.js`).uploadFiles(e),
  $apis.bodyLimit(94371840),
);
