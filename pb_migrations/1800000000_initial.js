// The initial schema of a single-user project. One hidden account signs in;
// spaces only partition knowledge. Every domain record belongs to one space,
// evidence and page revisions are immutable, and publications and the audit
// log are written by the hooks only. Databases created by earlier releases are
// refused before any migration runs (internal/bundle/legacy.go).
migrate(app => {
  const authed = "@request.auth.id != '' && @request.auth.collectionName = 'users'";

  // The built-in auth collection holds exactly one account (pb_hooks/account_access.js).
  // It is never readable through SQL and no one can list, create or change it over REST.
  const users = app.findCollectionByNameOrId('users');
  users.listRule = null;
  users.viewRule = "id = @request.auth.id";
  users.createRule = null;
  users.updateRule = null;
  users.deleteRule = null;
  users.manageRule = null;
  users.authRule = '';
  users.passwordAuth = {enabled: true, identityFields: ['email']};
  users.oauth2.enabled = false;
  users.otp.enabled = false;
  users.mfa.enabled = false;
  users.authToken.duration = 604800;
  users.authAlert.enabled = false;
  app.save(users);

  // Crew has no spaces or generic batch mutation surface.
  const config = app.settings();
  config.batch.enabled = false;
  app.save(config);
}, () => { throw new Error('Restore a verified complete backup for rollback'); });
