// Retire the inherited evidence domain only after its complete offline archive
// has been verified. Historical application migration names remain recognizable.
migrate((app) => {
  const retired = ["citations", "page_links", "publications", "page_revisions", "passages", "renditions", "ingestion_runs", "sources", "pages", "audit_log", "settings", "spaces"];
  const existing = app.findAllCollections().filter(c => retired.includes(c.name));
  if (existing.length) {
    $pocketcontext.recordKnowledgeArchive(app);
    for (const name of retired) {
      const collection = existing.find(c => c.name === name);
      if (collection) app.delete(collection);
    }
  }
  const config = app.settings();
  config.batch.enabled = false;
  app.save(config);
}, () => { throw new Error("Restore the verified legacy-knowledge archive with its original release; do not roll back a live database"); });
