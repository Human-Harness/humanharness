import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SettingFieldView, SettingsResult, SettingsState, SettingsView } from "./client";
import { Group as Card, Icon, Row, Rx } from "./guide";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Group {
  id: string | null;
  label?: string;
  fields: SettingFieldView[];
}

/** The fields with no section first, then each section in manifest order; empty groups are left out. */
export function groups(view: SettingsView, fields: SettingFieldView[]): Group[] {
  const known = new Set(view.sections.map((s) => s.id));
  const loose: Group = { id: null, fields: fields.filter((f) => f.section === undefined || !known.has(f.section)) };
  const sectioned = view.sections.map((s): Group => ({ id: s.id, label: s.label, fields: fields.filter((f) => f.section === s.id) }));
  return [loose, ...sectioned].filter((g) => g.fields.length > 0);
}

/** The key the reset's error is kept under (field names never are empty). */
const RESET = "";

/**
 * Settings › the harness's own tab (harness-settings spec §4): the core's controls, each change saved at once through
 * the data store. While a task is open, changes the agent reads wait for the next task (D4) and are marked "Pending".
 *
 * Radix stage 2e (DESIGN.md "Settings rows"): one card per section, a row per field; More options and the reset are
 * ghost row actions; a reset that fails is a red notice above the reset.
 */
export function HarnessSettingsTab({
  client,
  view,
  focus,
}: {
  client: HarnessClient;
  view: SettingsView;
  /**
   * Search opened Settings at this field (`harness:<name>`, §6): an advanced one opens with More settings expanded.
   * `n` changes on each search; the tab stays mounted, so a draft or a refusal on screen stays too.
   */
  focus?: { id: string; n: number };
}) {
  const { t } = useTranslation();
  const moreId = useId();
  const resetErrorId = useId();
  const [state, setState] = useState<SettingsState | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const advancedFocus = (id: string | undefined) => view.fields.some((f) => f.advanced && `harness:${f.name}` === id);
  const [more, setMore] = useState(() => advancedFocus(focus?.id));
  const focusN = focus?.n;
  useEffect(() => {
    if (advancedFocus(focus?.id)) setMore(true);
  }, [focusN]);

  useEffect(() => {
    let live = true;
    const off = client.settings.onChange((s) => {
      if (live) setState(s);
    });
    const offTasks = client.onTasks((v) => {
      if (live) setTaskOpen(v.current !== null);
    });
    client.settings.get().then(
      (s) => {
        if (live) setState((prev) => prev ?? s);
      },
      () => {},
    );
    client.getTasks().then(
      (v) => {
        if (live) setTaskOpen(v.current !== null);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
      offTasks();
    };
  }, [client]);

  // A field whose saved value changed (this window, another one, a restore): its old refusal no longer stands.
  const seen = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!state) return;
    const prev = seen.current;
    seen.current = state.values;
    if (!prev) return;
    const moved = Object.keys(state.values).filter((name) => !same(prev[name], state.values[name]));
    if (moved.length > 0) setErrors((e) => (moved.some((name) => Object.hasOwn(e, name)) ? Object.fromEntries(Object.entries(e).filter(([name]) => !moved.includes(name))) : e));
  }, [state]);

  if (!state) return <div aria-busy="true" />;

  const failed = t("settings.harness.failed");
  const settle = (key: string, r: SettingsResult) => {
    if (r.ok) {
      setState(r.state);
      // A reset puts every field back, so no field's old refusal stands.
      setErrors(key === RESET ? {} : ({ [key]: _gone, ...rest }) => rest);
    } else setErrors((e) => ({ ...e, [key]: r.message ?? failed }));
  };
  const fail = (key: string) => setErrors((e) => ({ ...e, [key]: failed }));
  const clear = (key: string) => setErrors((e) => (Object.hasOwn(e, key) ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));
  const save = (name: string, value: unknown) => {
    if (same(state.values[name], value)) return;
    client.settings.set(name, value).then(
      (r) => settle(name, r),
      () => fail(name),
    );
  };
  const reset = () =>
    client.settings.reset().then(
      (r) => settle(RESET, r),
      () => fail(RESET),
    );

  const valueOf = (f: SettingFieldView) => (Object.hasOwn(state.values, f.name) ? state.values[f.name] : f.default);
  const changed = view.fields.some((f) => !same(valueOf(f), f.default));
  const row = (f: SettingFieldView) => (
    <HarnessFieldRow
      key={f.name}
      setting={`harness:${f.name}`}
      field={f}
      value={valueOf(f)}
      error={Object.hasOwn(errors, f.name) ? errors[f.name] : undefined}
      pending={state.pending.includes(f.name)}
      onSave={(v) => save(f.name, v)}
      onDrop={() => clear(f.name)}
    />
  );
  const drawGroups = (fields: SettingFieldView[]) =>
    groups(view, fields).map((g) => (
      <Card key={g.id ?? ""} title={g.label}>
        {g.fields.map(row)}
      </Card>
    ));
  const advanced = view.fields.filter((f) => f.advanced);
  const resetError = Object.hasOwn(errors, RESET) ? errors[RESET] : undefined;

  return (
    <div>
      {/* Always mounted, so a screen reader hears the line each time a task opens. */}
      <Rx.Text as="p" size="1" color="gray" role="status" mb={taskOpen ? "3" : undefined}>
        {taskOpen ? t("settings.harness.nextTask") : ""}
      </Rx.Text>
      {drawGroups(view.fields.filter((f) => !f.advanced))}
      {advanced.length > 0 && (
        <>
          <Rx.Box mb="5">
            <Rx.Button variant="ghost" color="gray" size="1" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((o) => !o)}>
              <Icon name="chevron" size={14} />
              {t("settings.harness.more")}
            </Rx.Button>
          </Rx.Box>
          {more && <div id={moreId}>{drawGroups(advanced)}</div>}
        </>
      )}
      {changed && (
        <Rx.Flex direction="column" align="start" gap="3">
          {resetError && (
            <Rx.Callout.Root color="red" role="alert" id={resetErrorId}>
              <Rx.Callout.Text>{resetError}</Rx.Callout.Text>
            </Rx.Callout.Root>
          )}
          <Rx.Button variant="ghost" color="gray" size="1" onClick={() => void reset()} aria-describedby={resetError ? resetErrorId : undefined}>
            {t("settings.harness.reset")}
          </Rx.Button>
        </Rx.Flex>
      )}
    </div>
  );
}

/**
 * One setting with the core's control (also drawn by a plugin's detail, whose labels are the plugin's: bidi-isolated).
 * A settings row: the name (with a gray Pending badge while it waits for the next task) and help on the left, the
 * control on the right; a refusal is a red line under the row.
 */
export function HarnessFieldRow({
  setting,
  field,
  value,
  error,
  pending,
  onSave,
  onDrop,
}: {
  /** The row's `data-setting` (search, §6); a plugin's detail passes none. */
  setting?: string;
  field: SettingFieldView;
  value: unknown;
  error: string | undefined;
  pending: boolean;
  onSave: (value: unknown) => void;
  /** Escape dropped the draft: its refusal goes with it. */
  onDrop: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const helpId = `${id}-help`;
  const pendingId = `${id}-pending`;
  const errId = `${id}-error`;
  const describedBy = [pending ? pendingId : null, field.help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  const aria = { ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true as const } : {}) };
  const segmented = field.control === "segmented";
  let control;
  if (segmented) {
    control = (
      <Rx.SegmentedControl.Root value={String(value)} onValueChange={(v) => onSave(v)} aria-label={field.label} {...aria}>
        {(field.options ?? []).map((o) => (
          <Rx.SegmentedControl.Item key={o.value} value={o.value}>
            {o.label}
          </Rx.SegmentedControl.Item>
        ))}
      </Rx.SegmentedControl.Root>
    );
  } else if (field.control === "select") {
    control = (
      <Rx.Select.Root value={String(value)} onValueChange={(v) => onSave(v)}>
        <Rx.Select.Trigger id={id} aria-label={field.label} {...aria} />
        <Rx.Select.Content position="popper">
          {(field.options ?? []).map((o) => (
            <Rx.Select.Item key={o.value} value={o.value}>
              {o.label}
            </Rx.Select.Item>
          ))}
        </Rx.Select.Content>
      </Rx.Select.Root>
    );
  } else if (field.control === "toggle") {
    control = <Rx.Switch id={id} checked={value === true} onCheckedChange={(on) => onSave(on)} {...aria} />;
  } else {
    control = (
      <>
        <DraftInput id={id} field={field} value={value} aria={aria} onSave={onSave} onDrop={onDrop} />
        {field.unit && (
          <Rx.Text size="1" color="gray" dir="auto">
            {field.unit}
          </Rx.Text>
        )}
      </>
    );
  }
  const name = <bdi dir="auto">{field.label}</bdi>;
  return (
    <Row
      {...(segmented ? { "aria-label": field.label } : { htmlFor: id })}
      label={
        pending ? (
          <Rx.Flex as="span" align="center" gap="2" wrap="wrap">
            {name}
            <Rx.Badge color="gray" id={pendingId}>
              {t("settings.harness.pending")}
            </Rx.Badge>
          </Rx.Flex>
        ) : (
          name
        )
      }
      {...(field.help ? { hint: <bdi dir="auto">{field.help}</bdi>, hintId: helpId } : {})}
      below={
        error ? (
          <Rx.Text as="p" size="1" color="red" id={errId} role="alert">
            {error}
          </Rx.Text>
        ) : undefined
      }
      {...(setting ? { "data-setting": setting } : {})}
    >
      {control}
    </Row>
  );
}

/**
 * A number or a text: the person types freely; it saves on blur or Enter, so "12" never saves "1" first. Escape drops
 * the draft (and only then keeps the sheet open); an empty or unreadable number goes back to the saved value.
 */
function DraftInput({
  id,
  field,
  value,
  aria,
  onSave,
  onDrop,
}: {
  id: string;
  field: SettingFieldView;
  value: unknown;
  aria: Record<string, unknown>;
  onSave: (value: unknown) => void;
  onDrop: () => void;
}) {
  const saved = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  // The draft last sent: Enter then blur sends it once, and a refused one isn't sent again on blur.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    setDraft(saved);
    sent.current = null;
  }, [saved]);
  const number = field.control === "number";
  const commit = () => {
    if (draft === saved || draft === sent.current) return;
    if (number && (draft.trim() === "" || !Number.isFinite(Number(draft)))) {
      setDraft(saved);
      return;
    }
    sent.current = draft;
    onSave(number ? Number(draft) : draft);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape" && draft !== saved) {
      e.stopPropagation();
      setDraft(saved);
      sent.current = null;
      onDrop();
    }
  };
  const bounds = number
    ? { ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) }
    : field.max !== undefined
      ? { maxLength: field.max }
      : {};
  // A number is short; a text gets room for a name (DESIGN.md: "Number: field with min and max, unit after it, grey").
  return (
    <Rx.Box width={number ? "96px" : "240px"} maxWidth="100%">
      <Rx.TextField.Root id={id} type={number ? "number" : "text"} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} {...bounds} {...aria} />
    </Rx.Box>
  );
}
