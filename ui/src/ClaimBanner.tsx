import { useId, useState } from "react";
import { MoreMenu, type MenuItem } from "./DialogHeader";
import { t } from "./i18n";
import { claimTitle, type Claim } from "./projectAgents";
import {
  RelativeTime,
  formatDuration,
  formatExact,
  parseInstant,
  useNow,
} from "./relativeTime";

/**
 * A coding session's claim on the Edit task form (0.33.0), two lines at
 * phone width: "Claim expired · Implement" (or "Claimed · Implement") with a
 * ⋯ menu holding Copy details and Release claim, then when it started and
 * when it ends or ended, with a Details control that reveals the full
 * `claimed_by` (tool, session and hash). Exact times are in each time's
 * tooltip.
 */
export default function ClaimBanner({
  claim,
  agent,
  readOnly = false,
  busy = false,
  onRelease,
}: {
  claim: Claim;
  /** Short name reported by the claim holder. */
  agent: string;
  readOnly?: boolean;
  busy?: boolean;
  onRelease: () => void;
}) {
  const now = useNow();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const expired = claim.state === "expired";
  const until = parseInstant(claim.until);
  const items: MenuItem[] = [
    {
      label: t("Copy details"),
      icon: "copy",
      copy: {
        text: claimTitle(claim),
        onResult: (ok) => setCopied(ok ? "copied" : "failed"),
      },
    },
  ];
  if (!readOnly)
    items.push({
      label: t("Release claim"),
      icon: "unlock",
      disabled: busy,
      onSelect: onRelease,
    });
  return (
    <section
      className={`crew-claim-banner${expired ? " is-expired" : ""}`}
      aria-label={t("Claim")}
    >
      <div className="crew-claim-banner-head">
        <strong className="crew-claim-banner-title">
          {expired ? t("Claim expired · {agent}", { agent }) : t("Claimed · {agent}", { agent })}
        </strong>
        <MoreMenu items={items} label={t("Claim actions")} />
      </div>
      <p className="crew-claim-banner-times">
        <RelativeTime
          value={claim.started}
          prefix={t("Started ")}
          fallback={t("Start time unavailable")}
        />
        {until && (
          <>
            <span aria-hidden="true"> · </span>
            {expired ? (
              <RelativeTime value={claim.until} prefix={t("expired ")} />
            ) : (
              <time dateTime={until.toISOString()} title={formatExact(until)}>
                {t("ends in {duration}", {
                  duration: formatDuration(until.getTime() - now.getTime()),
                })}
              </time>
            )}
          </>
        )}
        <span aria-hidden="true"> · </span>
        <button
          type="button"
          className="crew-claim-banner-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {t("Details")}
        </button>
      </p>
      <p id={id} className="crew-claim-banner-details" hidden={!open}>
        {claim.by || t("No session details reported.")}
      </p>
      {copied && (
        <p className="crew-claim-banner-copied" role="status">
          {copied === "copied"
            ? t("Claim details copied.")
            : t("Couldn't copy the claim details.")}
        </p>
      )}
    </section>
  );
}
