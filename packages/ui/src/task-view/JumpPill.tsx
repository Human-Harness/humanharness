import { useTranslation } from "react-i18next";
import { Button } from "../guide/Button";

/** "2 new messages ↓": centred, 16 above the conversation card's bottom, while the reader is scrolled up. */
export function JumpPill({ count, onJump }: { count: number; onJump: () => void }) {
  const { t } = useTranslation();
  return (
    <Button kind="secondary" size="compact" className="hh-jump-pill" onClick={onJump}>
      {t("chat.newMessages", { count, defaultValue_one: "{{count}} new message ↓", defaultValue_other: "{{count}} new messages ↓" })}
    </Button>
  );
}
