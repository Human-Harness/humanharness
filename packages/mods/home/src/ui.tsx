import { defineMod } from "@humanharness/mod-sdk";
import { useApp } from "@humanharness/ui";
import { Home } from "./Home";

/** Home as the layout's `home/home` block: the app's state and ways out, as the core drew it before (step 0b1). */
export function HomeBlock() {
  const app = useApp();
  return (
    <Home
      state={app.state}
      client={app.client}
      onChange={app.setState}
      status={app.status}
      checkFailed={app.checkFailed}
      limits={app.limits}
      steps={app.steps}
      onStart={app.nav.start}
      onSetup={app.nav.setup}
      onSettings={app.nav.settings}
      onEngine={app.nav.engine}
      move={app.move}
      onAddProfile={app.nav.addProfile}
      language={app.language}
      onOpen={app.nav.open}
    />
  );
}

export default defineMod({
  id: "home",
  ui: (ctx) => {
    ctx.block("home", HomeBlock);
  },
});
