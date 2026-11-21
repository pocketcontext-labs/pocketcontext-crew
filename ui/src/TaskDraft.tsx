import {
  useState,
  useId,
  type ComponentProps,
  type ReactNode,
  type SetStateAction,
} from "react";
import { val, type Row } from "./crewApi";
import MarkdownField from "./MarkdownField";
import { AutoTextField } from "./AutoTextarea";
import { objects, type ReviewOption } from "./reviews";
import { t } from "./i18n";

/** The editor id stays stable while a key is being typed or a file uploads. */
export type EditorOption = ReviewOption & { editorId: string };
let nextEditorId = 0;
export function makeEditorOptions(
  options: ReviewOption[],
  previous: EditorOption[] = [],
): EditorOption[] {
  return options.map((option) => ({
    ...option,
    editorId:
      previous.find((old) => old.key === option.key)?.editorId ??
      String(++nextEditorId),
  }));
}
export const savedOptions = (options: ReviewOption[]) =>
  options.map(({ key, label, body }) => ({ key, label: label.trim(), body }));

export function draftFields(row?: Row) {
  return {
    draft: val(row, "draft"),
    draftOptions: JSON.stringify(
      savedOptions(objects(row?.draft_options) as ReviewOption[]),
    ),
    draftSelection: val(row, "draft_selection") === "one" ? "one" : "any",
    draftRecipient: val(row, "draft_recipient"),
  };
}

export type WorkingDraft = {
  draft: string;
  options: EditorOption[];
  mirrorId?: string;
};
function mirroredOption(state: WorkingDraft) {
  return (
    state.mirrorId ??
    (state.draft
      ? state.options.find((option) => option.body === state.draft)?.editorId
      : undefined)
  );
}
type OptionEdit = {
  key?: string;
  label?: string;
  body?: SetStateAction<string>;
};

/** Older tasks often use the body of one option as the main draft. Updating
 * that option through its one visible editor must update both copies. */
export function updateOption(
  state: WorkingDraft,
  id: string,
  edit: OptionEdit,
): WorkingDraft {
  const old = state.options.find((option) => option.editorId === id);
  if (!old) return state;
  const body =
    typeof edit.body === "function"
      ? edit.body(old.body)
      : (edit.body ?? old.body);
  const next = { ...old, ...edit, body };
  const mirrorId = mirroredOption(state);
  return {
    mirrorId,
    draft: mirrorId === id ? body : state.draft,
    options: state.options.map((option) => (option === old ? next : option)),
  };
}
export function removeOption(state: WorkingDraft, id: string): WorkingDraft {
  const mirrorId = mirroredOption(state);
  return {
    mirrorId: mirrorId === id ? undefined : mirrorId,
    draft: mirrorId === id ? "" : state.draft,
    options: state.options.filter((o) => o.editorId !== id),
  };
}

type MarkdownProps = ComponentProps<typeof MarkdownField>;
type FileProps = Pick<MarkdownProps, "onFiles" | "status">;
type TaskDraftProps = WorkingDraft & {
  recipient: string;
  selection: string;
  setRecipient: (value: string) => void;
  setSelection: (value: string) => void;
  onDraft: (value: string) => void;
  onOption: (id: string, edit: OptionEdit) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  files: (id?: string) => FileProps;
  readOnly: boolean;
  pending: boolean;
  dirtyReview: boolean;
  help?: ReactNode;
  request?: ReactNode;
};

const optionAnchor = (option: EditorOption) =>
  `crew-draft-option-${option.editorId}`;

function OptionEditor({
  option,
  index,
  readOnly,
  update,
  remove,
  files,
}: {
  option: EditorOption;
  index: number;
  readOnly: boolean;
  update: (edit: OptionEdit) => void;
  remove: () => void;
  files: FileProps;
}) {
  const [settingsOpen, setSettingsOpen] = useState(!option.label);
  const number = { n: index + 1 };
  return (
    <fieldset
      id={optionAnchor(option)}
      tabIndex={-1}
      className="crew-review-option crew-task-option"
    >
      <legend>{option.label || t("Option {n}", number)}</legend>
      <MarkdownField
        label={t("Option {n} draft", number)}
        value={option.body}
        maxLength={100000}
        required
        onChange={(body) => update({ body })}
        {...files}
      />
      {!readOnly && (
        <details
          open={settingsOpen}
          onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
        >
          <summary>{t("Option settings")}</summary>
          <AutoTextField
            className="crew-option-note"
            label={t("Option {n} label", number)}
            value={option.label}
            maxLength={200}
            required
            onValue={(label) => update({ label })}
          />
          <label className="crew-option-note">
            {t("Option {n} key", number)}
            <input
              value={option.key}
              required
              maxLength={64}
              pattern="[a-zA-Z0-9_\-]{1,64}"
              onChange={(e) => update({ key: e.target.value })}
            />
          </label>
          <button type="button" onClick={remove}>
            {t("Remove option {n}", number)}
          </button>
        </details>
      )}
    </fieldset>
  );
}

/** All alternatives are part of the task. Only the separate Request approval
 * action freezes them, so both editable and pending tasks have the same fields. */
export default function TaskDraft(props: TaskDraftProps) {
  const { draft, options, readOnly, files } = props;
  const [contextOpen, setContextOpen] = useState(Boolean(draft));
  const recipientHint = useId();
  const hasOptions = options.length > 0;
  const mirrored = !!mirroredOption(props);
  const add = (
    <button type="button" disabled={options.length >= 20} onClick={props.onAdd}>
      {t("Add review option")}
    </button>
  );
  return (
    <section
      className="crew-task-draft"
      aria-label={hasOptions ? t("Draft for review") : undefined}
    >
      {hasOptions ? (
        <h3>
          {t("Draft for review")} {props.help}
        </h3>
      ) : (
        <MarkdownField
          label={t("Draft for review")}
          help={props.help}
          hint={t(
            "Save work for approval here. Put progress updates in Comments.",
          )}
          className="crew-long-text"
          value={draft}
          onChange={props.onDraft}
          {...files()}
        />
      )}
      {options.length > 1 && (
        <label className="crew-option-jump">
          {t("Jump to option")}
          <select
            value=""
            onChange={(event) => {
              // Navigation must not mark the task as edited.
              event.stopPropagation();
              const card = document.getElementById(event.currentTarget.value);
              card?.focus({ preventScroll: true });
              card?.scrollIntoView?.({ block: "start" });
            }}
          >
            <option value="" disabled>
              {t("{n} options", { n: options.length })}
            </option>
            {options.map((option, index) => (
              <option key={option.editorId} value={optionAnchor(option)}>
                {option.label || t("Option {n}", { n: index + 1 })}
              </option>
            ))}
          </select>
        </label>
      )}
      {options.map((option, index) => (
        <OptionEditor
          key={option.editorId}
          option={option}
          index={index}
          update={(edit) => props.onOption(option.editorId, edit)}
          remove={() => props.onRemove(option.editorId)}
          readOnly={readOnly}
          files={files(option.editorId)}
        />
      ))}
      {hasOptions && !mirrored && (!readOnly || !!draft) && (
        <details
          open={contextOpen}
          onToggle={(e) => setContextOpen(e.currentTarget.open)}
        >
          <summary>{t("Draft context")}</summary>
          <MarkdownField
            label={t("Draft context")}
            className="crew-long-text"
            value={draft}
            onChange={props.onDraft}
            {...files()}
          />
        </details>
      )}
      {!readOnly && (
        <div className="crew-review-request">
          <details>
            <summary>
              {hasOptions
                ? t("Review settings")
                : t("Review alternatives (optional)")}
            </summary>
            <div className="crew-review-settings-fields">
              <div>
                <label className="crew-option-note">
                  {t("Recipient (optional)")}
                  <input
                    aria-describedby={recipientHint}
                    maxLength={200}
                    value={props.recipient}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    onChange={(e) => props.setRecipient(e.target.value)}
                  />
                </label>
                <p className="crew-review-hint" id={recipientHint}>{t("Who will read the finished draft? For example, a new teammate. This field describes the audience only.")}</p>
              </div>
              {hasOptions && (
                <label>
                  {t("Selection")}
                  <select
                    value={props.selection}
                    onChange={(e) => props.setSelection(e.target.value)}
                  >
                    <option value="any">{t("Pick any")}</option>
                    <option value="one">{t("Pick one")}</option>
                  </select>
                </label>
              )}
            </div>
            <div className="crew-review-add-option">
              <p className="crew-review-hint">{t("Add options when you want the reviewer to choose between drafts. For a single draft, skip this step.")}</p>
              {add}
            </div>
          </details>
          {props.pending && props.dirtyReview && (
            <p className="crew-review-hint" role="status">
              {t("Saving these changes will withdraw the pending review.")}
            </p>
          )}
          {props.request}
        </div>
      )}
    </section>
  );
}
