import type { BlockProps } from "@humanharness/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface FileRef {
  path: string;
  role: string;
}

const isFile = (f: unknown): f is FileRef => !!f && typeof (f as FileRef).path === "string" && typeof (f as FileRef).role === "string";

/** `show_files`: where the answer lives in the code, each file with an "Open" button (the app checks the path). */
export function FilesBlock({ data, open }: BlockProps) {
  const { t } = useTranslation("harness");
  const [failed, setFailed] = useState<string | null>(null);
  const files = Array.isArray(data?.files) ? (data.files as unknown[]).filter(isFile) : [];
  if (files.length === 0) return null;
  const openFile = (file: string) => {
    setFailed(null);
    open(file).then(
      (ok) => setFailed(ok ? null : file),
      () => setFailed(file),
    );
  };
  return (
    <article className="demo-files" aria-label={t("files")}>
      <span className="demo-kicker">{t("files")}</span>
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code>
            <span>{f.role}</span>
            <button type="button" aria-label={t("openLabel", { path: f.path })} onClick={() => openFile(f.path)}>
              {t("open")}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="hh-warn">
          {t("openFailed", { path: failed })}
        </p>
      )}
    </article>
  );
}
