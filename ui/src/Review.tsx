import { useId, useRef, useState, type ComponentType } from "react";
import { AttachmentsProvider, ProseImage, ProseLink } from "./Attachments";
import type { Attachment } from "./attachmentsApi";
import { val, type Row } from "./crewApi";
import {
  decisionSummary,
  missingReviewEvidence,
  optionDecisions,
  reviewFiles,
  reviewOptions,
  type OptionDecision,
  type ReviewOption,
} from "./reviews";
import "./review.css";

type ProseComponent = ComponentType<{ children: string }>;
export function ReviewContent({
  row,
  attachments,
  loaded = true,
  Prose,
  children,
}: {
  row: Row;
  attachments: Attachment[];
  loaded?: boolean;
  Prose: ProseComponent;
  children?: React.ReactNode;
}) {
  const files = reviewFiles(row, attachments);
  const missing = missingReviewEvidence(row, files, loaded);
  return (
    <AttachmentsProvider attachments={files}>
      <div className="crew-review-content">
        {missing.length > 0 && (
          <div className="crew-alert" role="alert">
            <p>
              This draft mentions files that aren't attached to Crew. Request
              changes and ask the agent to attach them.
            </p>
            <ul>
              {missing.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="crew-draft-snapshot">
          <Prose>{val(row, "draft")}</Prose>
        </div>
        {children}
        {files.length > 0 && (
          <section aria-label="Files submitted for review">
            <h3>Files submitted for review</h3>
            <div className="crew-review-gallery">
              {files.map((file) => (
                <figure key={file.id}>
                  {file.image ? (
                    <ProseImage src={`attachment:${file.id}`} alt={file.name} />
                  ) : (
                    <ProseLink href={`attachment:${file.id}`}>
                      {file.name}
                    </ProseLink>
                  )}
                  <figcaption>{file.name}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </AttachmentsProvider>
  );
}

export function ReviewChoices({
  row,
  Prose,
  value,
  onChange,
}: {
  row: Row;
  Prose: ProseComponent;
  value?: OptionDecision[];
  onChange?: (value: OptionDecision[]) => void;
}) {
  const prefix = useId();
  const choices = value || optionDecisions(row);
  return (
    <div className="crew-review-options">
      {reviewOptions(row).map((option) => {
        const choice = choices.find((x) => x.key === option.key);
        const update = (patch: Partial<OptionDecision>) =>
          onChange?.([
            ...choices.filter((x) => x.key !== option.key),
            { key: option.key, ...choice, ...patch } as OptionDecision,
          ]);
        return (
          <section
            key={option.key}
            className="crew-review-option"
            aria-label={option.label}
          >
            <h3>{option.label}</h3>
            <Prose>{option.body}</Prose>
            {onChange ? (
              <>
                <fieldset className="crew-option-decision">
                  <legend>Decision for {option.label}</legend>
                  {(["approved", "rejected"] as const).map((decision) => (
                    <label key={decision}>
                      <input
                        type="radio"
                        name={`${prefix}-${option.key}`}
                        checked={choice?.decision === decision}
                        onChange={() => update({ decision })}
                      />
                      {decision === "approved" ? "Approve" : "Reject"}
                    </label>
                  ))}
                </fieldset>
                <label className="crew-option-note">
                  Note for {option.label} (optional)
                  <textarea
                    maxLength={20000}
                    value={choice?.note || ""}
                    onChange={(e) => update({ note: e.target.value })}
                  />
                </label>
              </>
            ) : (
              <>
                {choice && (
                  <p>
                    <strong>
                      {choice.decision === "approved" ? "Approved" : "Rejected"}
                    </strong>
                    {choice.note && ` — ${choice.note}`}
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ReviewDecision({
  row,
  busy,
  error,
  attachments,
  loaded,
  Prose,
  when,
  save,
}: {
  row: Row;
  busy: boolean;
  error: string;
  attachments: Attachment[];
  loaded: boolean;
  Prose: ProseComponent;
  when: (time: unknown) => string;
  save: (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
  ) => Promise<void>;
}) {
  // Uncontrolled: typing a note re-renders nothing, so the draft and its
  // images stay put.
  const note = useRef<HTMLTextAreaElement>(null);
  const [choices, setChoices] = useState<OptionDecision[]>([]);
  const options = reviewOptions(row),
    pending = val(row, "status") === "pending";
  const complete = options.every((o) =>
    choices.some((c) => c.key === o.key && !!c.decision),
  );
  const anyApproved = choices.some((c) => c.decision === "approved");
  const submit = (decision: string) => {
    const decisions =
      decision === "rejected"
        ? options.map((o) => ({
            key: o.key,
            decision: "rejected",
            note: choices.find((c) => c.key === o.key)?.note || "",
          }))
        : choices.filter((c) => c.decision);
    void save(
      "review.decide",
      {
        decision,
        note: note.current?.value ?? "",
        ...(options.length ? { option_decisions: decisions } : {}),
      },
      row,
    );
  };
  return (
    <div className="crew-dialog-body">
      <div className="crew-review-meta">
        <span className={pending ? "crew-human" : "crew-pill"}>
          {val(row, "status").replaceAll("_", " ")}
        </span>
        <span>
          Snapshot {row.id} · {when(row.created)}
        </span>
      </div>
      <p>
        This is the exact submitted draft. Approval does not send, post or
        publish it.
      </p>
      <ReviewContent
        row={row}
        attachments={attachments}
        loaded={loaded}
        Prose={Prose}
      >
        <ReviewChoices
          row={row}
          Prose={Prose}
          value={pending ? choices : undefined}
          onChange={pending ? setChoices : undefined}
        />
      </ReviewContent>
      {!!decisionSummary(row) && (
        <p className="crew-review-decision-summary">{decisionSummary(row)}</p>
      )}
      {val(row, "decision_note") && (
        <p>
          <strong>Your decision note:</strong> {val(row, "decision_note")}
        </p>
      )}
      {pending && (
        <>
          <label className="crew-option-note">
            Decision note
            <textarea
              ref={note}
              defaultValue=""
              maxLength={20000}
              placeholder="Feedback for the next revision"
            />
          </label>
          {options.length > 0 && (
            <p className="crew-footnote">
              Choose Approve or Reject for every option. Approve at least one
              option to approve the review.
            </p>
          )}
          <div className="crew-actions">
            <button
              className="crew-primary"
              disabled={
                busy || (options.length > 0 && (!complete || !anyApproved))
              }
              onClick={() => submit("approved")}
            >
              {options.length ? "Approve selected options" : "Approve draft"}
            </button>
            <button disabled={busy} onClick={() => submit("changes_requested")}>
              Request changes
            </button>
            <button
              className="crew-danger"
              disabled={busy}
              onClick={() => submit("rejected")}
            >
              Reject
            </button>
          </div>
          <p className="crew-footnote">
            After approval, perform the external action yourself and mark the
            task Done.
          </p>
        </>
      )}
      {error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReviewRequest({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (options: ReviewOption[]) => void;
}) {
  const [options, setOptions] = useState<ReviewOption[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const valid = options.every((o) => o.label.trim() && o.body.trim());
  return (
    <div className="crew-review-request">
      <details>
        <summary>Review alternatives (optional)</summary>
        <p>
          Give each draft or platform its own option so the reviewer can choose
          exactly what to approve. Options are saved when you send the review.
        </p>
        {options.map((option, index) => (
          <fieldset key={option.key} className="crew-review-option">
            <legend>Option {index + 1}</legend>
            <label className="crew-option-note">
              Option {index + 1} label
              <input
                maxLength={200}
                value={option.label}
                onChange={(e) =>
                  setOptions(
                    options.map((o) =>
                      o.key === option.key
                        ? { ...o, label: e.target.value }
                        : o,
                    ),
                  )
                }
              />
            </label>
            <label className="crew-option-note">
              Option {index + 1} draft
              <textarea
                maxLength={100000}
                value={option.body}
                onChange={(e) =>
                  setOptions(
                    options.map((o) =>
                      o.key === option.key ? { ...o, body: e.target.value } : o,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setOptions(options.filter((o) => o.key !== option.key))
              }
            >
              Remove option {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={options.length >= 20}
          onClick={() => {
            setOptions([
              ...options,
              { key: `option-${nextKey}`, label: "", body: "" },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          Add review option
        </button>
      </details>
      <button
        type="button"
        className="crew-review-submit"
        disabled={busy || !valid}
        onClick={() => submit(options)}
      >
        Send draft for approval
      </button>
    </div>
  );
}
