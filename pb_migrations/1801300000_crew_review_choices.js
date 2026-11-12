// Crew 0.20.0: immutable review choices and stable hold/claim start timestamps.
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(new TextField({ name: "held_since", max: 100 }));
    tasks.fields.add(new TextField({ name: "claimed_at", max: 100 }));
    app.save(tasks);
    // Legacy hold starts were not recorded. Freeze the old updated value once;
    // subsequent edits cannot make the same old hold appear new.
    app
      .db()
      .newQuery(
        "UPDATE crew_tasks SET held_since=updated WHERE readiness='waiting' AND status NOT IN ('done','wont_do')",
      )
      .execute();
    // Recover a legacy claim start only when its matching claim event exists.
    app
      .db()
      .newQuery(
        "UPDATE crew_tasks SET claimed_at=COALESCE((SELECT created FROM crew_events WHERE parent=crew_tasks.id AND action='task.claim' ORDER BY created DESC LIMIT 1),'') WHERE claimed_by!='' OR claim_until!=''",
      )
      .execute();
    const reviews = app.findCollectionByNameOrId("crew_reviews");
    reviews.fields.add(new JSONField({ name: "options", maxSize: 1048576 }));
    reviews.fields.add(
      new JSONField({ name: "option_decisions", maxSize: 1048576 }),
    );
    app.save(reviews);
  },
  () => {
    throw new Error(
      "Restore a verified complete backup; review choices and hold timestamps cannot be rolled back live",
    );
  },
);
