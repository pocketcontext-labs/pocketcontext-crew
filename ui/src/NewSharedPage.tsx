import { useState, type FormEvent } from "react";
import { crewApi } from "./crewApi";
import { t } from "./i18n";
import { Sheet } from "./MobileChrome";

/**
 * Home's + → Shared page (0.34.0): a title, then a new draft (artifact.create)
 * that opens for editing on Shared. Publishing stays in the owner's browser
 * on the Shared page, as for every draft.
 */
export default function NewSharedPage({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError(t("Give the page a title."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await crewApi.write(
        "artifact.create",
        { title: name, body: "" },
        undefined,
        "New shared page",
      );
      onCreated(created.id as string);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Could not create the page."),
      );
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={t("New shared page")}
      className="crew-new-shared"
      onClose={onClose}
    >
      <form className="crew-new-shared-form" onSubmit={(e) => void submit(e)}>
        <p>
          {t(
            "Start a draft page you can share by a secret link. You write it on Shared and publish it when it's ready; nothing is public until then.",
          )}
        </p>
        <label>
          {t("Title")}
          <input
            value={title}
            maxLength={300}
            autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="crew-alert">
            {error}
          </p>
        )}
        <button className="crew-primary" type="submit" disabled={busy}>
          {busy ? t("Creating…") : t("Create draft")}
        </button>
      </form>
    </Sheet>
  );
}
