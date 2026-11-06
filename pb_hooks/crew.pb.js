// Only authenticated custom operations can mutate Crew records. Generic REST,
// batch and SQL cannot manufacture approvals or rewrite history.
routerAdd(
  "POST",
  "/api/crew/read",
  (e) => require(`${__hooks}/crew.js`).read(e),
  $apis.requireAuth("users"),
);
routerAdd(
  "POST",
  "/api/crew/write",
  (e) => require(`${__hooks}/crew.js`).write(e, false),
  $apis.requireAuth("users"),
);
routerAdd(
  "POST",
  "/api/crew/agent-write",
  (e) => require(`${__hooks}/crew.js`).write(e, true),
  $apis.requireAuth("users"),
);
