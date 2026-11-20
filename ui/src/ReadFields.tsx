import type { ReactNode } from "react";
import { t } from "./i18n";

export function ReadTitle({ title }: { title: string }) {
  return (
    <div className="crew-field">
      <span>{t("Title")}</span>
      <h3 className="crew-read-title">{title}</h3>
    </div>
  );
}

export function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="crew-md-field">
      <div className="crew-md-label">
        <h3 className="crew-md-name">{label}</h3>
      </div>
      <div className="crew-md-box">
        <div className="crew-md-preview">{children}</div>
      </div>
    </div>
  );
}
