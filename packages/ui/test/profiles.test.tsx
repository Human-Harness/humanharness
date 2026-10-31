// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROFILE_COLLECTION as SDK_COLLECTION, PROFILE_COLORS } from "@humanharness/harness-sdk";
import { HarnessApp } from "../src";
import { Home } from "../src/Home";
import { AVATAR_COLORS, PROFILE_COLLECTION } from "../src/profiles";
import { Avatar, ProfileAvatar, ProfileSwitcher } from "../src/ProfileSwitcher";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Family", engineId: "claude" };
const PEOPLE = [
  { id: "sofi", title: "Sofi", color: "coral", createdAt: "2026-10-27T10:00:00.000Z", archived: false },
  { id: "tomas", title: "Tomás", createdAt: "2026-10-27T10:00:00.000Z", archived: false },
  { id: "old", title: "Old", createdAt: "2026-10-27T10:00:00.000Z", archived: true },
];

function family(active = "sofi", list = PEOPLE) {
  const client = new FakeClient({ ...configured, profile: active });
  client.state = { ...client.state, profiles: { label: "student", form: { fields: [] } } };
  client.profileList = list;
  return client;
}

async function home(client: FakeClient) {
  const onChange = vi.fn();
  const onAddProfile = vi.fn();
  await renderIn(
    "en",
    <Home
      state={client.state}
      client={client}
      onChange={onChange}
      status={client.status}
      limits={null}
      onStart={() => {}}
      onSetup={() => {}}
      onSettings={() => {}}
      onEngine={() => {}}
      onAddProfile={onAddProfile}
    />,
  );
  return { onChange, onAddProfile };
}

describe("the window copies the SDK's profile names", () => {
  it("the collection and the avatar colours", () => {
    expect(PROFILE_COLLECTION).toBe(SDK_COLLECTION);
    expect([...AVATAR_COLORS]).toEqual([...PROFILE_COLORS]);
  });
});

describe("the profile switcher (profiles spec §5 'Where the switcher lives')", () => {
  it("D0: Home without profiles has no switcher", async () => {
    await home(new FakeClient(configured));
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Choose / })).toBeNull();
  });

  it("one profile: its name and Add", async () => {
    const client = family("sofi", PEOPLE.slice(0, 1));
    const { onAddProfile } = await home(client);
    expect(await screen.findByText("Sofi")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    expect(onAddProfile).toHaveBeenCalledOnce();
  });

  it("several: a select of the profiles not archived; picking one switches and hands back the new state", async () => {
    const client = family();
    const { onChange } = await home(client);
    const select = (await screen.findByRole("combobox", { name: "Choose student" })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Sofi", "Tomás"]);
    fireEvent.change(select, { target: { value: "tomas" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ profile: "tomas" }) })));
    expect(client.profileCalls).toEqual(["open:tomas"]);
  });

  it("a refused switch says why", async () => {
    const client = family();
    client.profileRefusal = { ok: false, reason: "busy" };
    await home(client);
    fireEvent.change(await screen.findByRole("combobox", { name: "Choose student" }), { target: { value: "tomas" } });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Wait until the AI finishes, then try again.");
  });

  it("Home's switcher is disabled while the folder moves", async () => {
    const client = family();
    const move = { moving: true, error: null, moved: null, failures: 0, trigger: { current: null }, move: async () => {}, chooseAnother: async () => {} };
    await renderIn(
      "en",
      <Home
        state={client.state}
        client={client}
        onChange={() => {}}
        status={client.status}
        limits={null}
        onStart={() => {}}
        onSetup={() => {}}
        onSettings={() => {}}
        onEngine={() => {}}
        move={move}
        onAddProfile={() => {}}
      />,
    );
    expect(((await screen.findByRole("combobox", { name: "Choose student" })) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add student" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is disabled while a turn runs", async () => {
    const client = family();
    await renderIn("en", <ProfileSwitcher client={client} state={client.state} onSwitched={() => {}} onAdd={() => {}} disabled />);
    expect(((await screen.findByRole("combobox", { name: "Choose student" })) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add student" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the switcher on the work screen's top bar", () => {
  it("switches from the work screen, then Home redraws for the new profile; D0: no switcher there without profiles", async () => {
    const client = family();
    const { unmount } = await renderIn("en", <HarnessApp client={client} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole("button", { name: "Home" });
    // The switcher opens from the top bar's avatar (UI refresh spec §4.1).
    fireEvent.click(await screen.findByRole("button", { name: "Profile: Sofi" }));
    const select = (await screen.findByRole("combobox", { name: "Choose student" })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "tomas" } });
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose student" }) as HTMLSelectElement).value).toBe("tomas"));
    expect(client.profileCalls).toEqual(["open:tomas"]);
    // Home again (spec §5): the new profile's required setup steps are checked before its work screen.
    expect(await screen.findByRole("button", { name: "Start Demo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    unmount();

    await renderIn("en", <HarnessApp client={new FakeClient(configured)} />);
    const plain = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(plain.disabled).toBe(false));
    fireEvent.click(plain);
    await screen.findByRole("button", { name: "Home" });
    expect(screen.queryByRole("button", { name: /^Profile:/ })).toBeNull();
  });
});

describe("Avatar", () => {
  it("the title's first letter, coloured only with a known colour", async () => {
    const { container } = await renderIn(
      "en",
      <>
        <Avatar profile={{ title: "sofi", color: "coral" }} />
        <Avatar profile={{ title: "Ña", color: "#ff0000" }} />
      </>,
    );
    const marks = container.querySelectorAll(".hh-avatar");
    expect([...marks].map((m) => [m.textContent, m.getAttribute("data-color")])).toEqual([
      ["S", "coral"],
      ["Ñ", null],
    ]);
  });
});

describe("ProfileAvatar", () => {
  it("closes its popover when focus leaves it, not when focus moves inside it", async () => {
    const client = family();
    await renderIn(
      "en",
      <>
        <ProfileAvatar client={client} state={client.state} onSwitched={() => {}} onAdd={() => {}} />
        <button>Elsewhere</button>
      </>,
    );
    const avatar = await screen.findByRole("button", { name: "Profile: Sofi" });
    fireEvent.click(avatar);
    const select = await screen.findByRole("combobox", { name: "Choose student" });
    fireEvent.blur(avatar, { relatedTarget: select });
    expect(screen.getByRole("dialog", { name: "Choose student" })).toBeTruthy();
    fireEvent.blur(select, { relatedTarget: screen.getByRole("button", { name: "Elsewhere" }) });
    expect(screen.queryByRole("dialog", { name: "Choose student" })).toBeNull();
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
  });

  it("draws the initial and colour by Avatar's rule", async () => {
    const client = family("tomas", [{ id: "tomas", title: " ñandú", color: "#ff0000", createdAt: "2026-10-27T10:00:00.000Z", archived: false }]);
    await renderIn("en", <ProfileAvatar client={client} state={client.state} onSwitched={() => {}} onAdd={() => {}} />);
    const avatar = await screen.findByRole("button", { name: /^Profile:/ });
    expect(avatar.textContent).toBe("Ñ");
    expect(avatar.getAttribute("data-color")).toBeNull();
  });
});
