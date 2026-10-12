import { type BlockProps, canOpenFile } from "@humanharness/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface FileRef {
  path: string;
  role: string;
}

const isFile = (f: unknown): f is FileRef => !!f && typeof (f as FileRef).path === "string" && typeof (f as FileRef).role === "string";

/**
 * `show_files`: where the answer lives in the code. Each file gets "Open" when the app opens its kind (docs,
 * data, images) and "Show in Finder" otherwise (source files); the app checks the path either way.
 */
export function FilesBlock({ data, open, reveal }: BlockProps) {
  const { t } = useTranslation("harness");
  const [failed, setFailed] = useState<{ path: string; reveal: boolean } | null>(null);
  const files = Array.isArray(data?.files) ? (data.files as unknown[]).filter(isFile) : [];
  if (files.length === 0) return null;
  const act = (file: string) => {
    const revealing = !canOpenFile(file);
    setFailed(null);
    (revealing ? reveal : open)(file).then(
      (ok) => setFailed(ok ? null : { path: file, reveal: revealing }),
      () => setFailed({ path: file, reveal: revealing }),
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
            {canOpenFile(f.path) ? (
              <button type="button" aria-label={t("openLabel", { path: f.path })} onClick={() => act(f.path)}>
                {t("open")}
              </button>
            ) : (
              <button type="button" aria-label={t("revealLabel", { path: f.path })} onClick={() => act(f.path)}>
                {t("reveal")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="hh-warn">
          {t(failed.reveal ? "revealFailed" : "openFailed", { path: failed.path })}
        </p>
      )}
    </article>
  );
}
