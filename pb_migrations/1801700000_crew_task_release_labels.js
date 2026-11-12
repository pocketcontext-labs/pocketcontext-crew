// Crew 0.23.0 removes the task release field: releases are labels. Every task
// with a non-empty release gets the label release-<value> (unless it already
// carries it), then the release column is dropped. The label change is a raw
// update that increments revision (so cached writers reread and the search
// index refreshes) but keeps updated, so Done and Won't do keep their order
// and the 7-day window. Like every Crew collection, the API rules stay null.
// The down migration restores the column from the release-* labels and keeps
// the labels.
migrate(
  (app) => {
    const rows = arrayOf(
      new DynamicModel({ id: "", release: "", labels: "" }),
    );
    app
      .db()
      .newQuery(
        "SELECT id, COALESCE(release,'') AS release, COALESCE(labels,'') AS labels FROM crew_tasks WHERE TRIM(COALESCE(release,''))!=''",
      )
      .all(rows);
    for (const row of rows) {
      let labels = [];
      try {
        const parsed = JSON.parse(row.labels || "[]");
        if (Array.isArray(parsed)) labels = parsed;
      } catch (_) {}
      const label = "release-" + row.release.trim();
      if (labels.includes(label)) continue;
      labels.push(label);
      app
        .db()
        .newQuery(
          "UPDATE crew_tasks SET labels={:labels}, revision=revision+1 WHERE id={:id}",
        )
        .bind({ labels: JSON.stringify(labels), id: row.id })
        .execute();
    }
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.removeByName("release");
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(new TextField({ name: "release", max: 32 }));
    app.save(tasks);
    const rows = arrayOf(new DynamicModel({ id: "", labels: "" }));
    app
      .db()
      .newQuery(
        "SELECT id, COALESCE(labels,'') AS labels FROM crew_tasks WHERE labels LIKE '%release-%'",
      )
      .all(rows);
    for (const row of rows) {
      let labels = [];
      try {
        const parsed = JSON.parse(row.labels || "[]");
        if (Array.isArray(parsed)) labels = parsed;
      } catch (_) {}
      const found = labels.filter(
        (x) => typeof x === "string" && /^release-.{1,32}$/.test(x),
      );
      if (!found.length) continue;
      app
        .db()
        .newQuery("UPDATE crew_tasks SET release={:release} WHERE id={:id}")
        .bind({ release: found[found.length - 1].slice(8), id: row.id })
        .execute();
    }
  },
);
