// Working review options live on the task. The submitted review stays frozen.
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("crew_tasks");
    tasks.fields.add(new JSONField({ name: "draft_options", maxSize: 1048576 }));
    tasks.fields.add(new SelectField({ name: "draft_selection", values: ["any", "one"], maxSelect: 1 }));
    tasks.fields.add(new TextField({ name: "draft_recipient", max: 200 }));
    app.save(tasks);
    app.db().newQuery("UPDATE crew_tasks SET draft_options = '[]', draft_selection = 'any'").execute();
    // One pending review per task. Direct SQL preserves updated and revision.
    app.db().newQuery(`
      UPDATE crew_tasks AS t SET (draft_options, draft_selection, draft_recipient) = (
        SELECT CASE WHEN json_type(r.options) = 'array' THEN r.options ELSE '[]' END,
               CASE WHEN r.selection = 'one' THEN 'one' ELSE 'any' END, r.recipient
        FROM crew_reviews AS r WHERE r.task = t.id AND r.status = 'pending'
        ORDER BY r.created DESC, r.id DESC LIMIT 1
      ) WHERE EXISTS (SELECT 1 FROM crew_reviews AS r WHERE r.task = t.id AND r.status = 'pending')
    `).execute();
  },
  () => {
    throw new Error("Restore the complete pre-upgrade backup to roll back task draft options");
  },
);
