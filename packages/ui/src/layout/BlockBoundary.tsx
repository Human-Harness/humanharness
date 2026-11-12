import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Rx } from "../guide";

/** A mod's block that crashed: "This part of the app failed", the mod's name and Turn off (minimal-core spec §5.1). */
export class BlockBoundary extends Component<{ name: string; onTurnOff: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <FailedBlock name={this.props.name} onTurnOff={this.props.onTurnOff} /> : this.props.children;
  }
}

function FailedBlock({ name, onTurnOff }: { name: string; onTurnOff: () => void }) {
  const { t } = useTranslation();
  return (
    <Rx.Box p="4">
      <Rx.Callout.Root color="red" role="alert">
        <Rx.Callout.Text weight="medium">{t("layout.failed")}</Rx.Callout.Text>
        <Rx.Callout.Text>{name}</Rx.Callout.Text>
        <Rx.Flex>
          <Rx.Button variant="outline" color="gray" size="1" onClick={onTurnOff}>
            {t("layout.turnOff")}
          </Rx.Button>
        </Rx.Flex>
      </Rx.Callout.Root>
    </Rx.Box>
  );
}
