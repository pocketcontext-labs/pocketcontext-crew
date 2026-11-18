import { useId, useState } from "react";
import { MoreMenu, type MenuItem } from "./DialogHeader";
import { claimTitle, copyText, type Claim } from "./projectAgents";
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
  /** The agent's name only, never the session's. */
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
      label: "Copy details",
      icon: "copy",
      onSelect: () =>
        void copyText(claimTitle(claim)).then((ok) =>
          setCopied(ok ? "copied" : "failed"),
        ),
    },
  ];
  if (!readOnly)
    items.push({
      label: "Release claim",
      icon: "unlock",
      disabled: busy,
      onSelect: onRelease,
    });
  return (
    <section
      className={`crew-claim-banner${expired ? " is-expired" : ""}`}
      aria-label="Claim"
    >
      <div className="crew-claim-banner-head">
        <strong className="crew-claim-banner-title">
          {expired ? "Claim expired" : "Claimed"} · {agent}
        </strong>
        <MoreMenu items={items} label="Claim actions" />
      </div>
      <p className="crew-claim-banner-times">
        <RelativeTime
          value={claim.started}
          prefix="Started "
          fallback="Start time unavailable"
        />
        {until && (
          <>
            <span aria-hidden="true"> · </span>
            {expired ? (
              <RelativeTime value={claim.until} prefix="expired " />
            ) : (
              <time dateTime={until.toISOString()} title={formatExact(until)}>
                ends in {formatDuration(until.getTime() - now.getTime())}
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
          Details
        </button>
      </p>
      <p id={id} className="crew-claim-banner-details" hidden={!open}>
        {claim.by || "No session details reported."}
      </p>
      {copied && (
        <p className="crew-claim-banner-copied" role="status">
          {copied === "copied"
            ? "Claim details copied."
            : "Couldn't copy the claim details."}
        </p>
      )}
    </section>
  );
}
