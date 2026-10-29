# On this day

The demo harness's plugin, and the complete example the `/new-plugin` guide points to: a source, a collection, a panel, a chip, an attention rule and an action.

## Purpose

Shows what happened on today's date in other years, from Wikimedia's public "On this day" feed, so a person exploring the demo sees a plugin at work: data on a TTL, a panel, a chip, an inbox item and a prepared question. It starts off; nothing reaches Wikimedia until the person turns it on in Settings › Plugins.

## Sources

| Source | Brings | TTL |
|---|---|---|
| events | Today's selected events (year, text, the first Wikipedia page), up to the `count` setting | 6 h |

## Rules

- A round anniversary is an event a whole multiple of 25 years ago. Each one raises an `info` item `round-<year>` ("<n> years ago today", the first 200 characters of the text), which opens the panel on that event.
- Only the stored events are looked at: with a lower `count`, a round anniversary may not be among them.
- At each sync, the round items of the previous list that aren't round today are resolved, derived from the stored list before it is replaced (no extra collection).
- The chip says "<n>-year anniversary today" when there is one, else "<n> events today".

## Panels

- Panel `events` (On this day), in the core's Plugins section: the events newest first (Year, Event), the Wikipedia page as plain text, and an Explain button per row. An attention item's target highlights its row and scrolls to it.
- Chip `today`: the anniversary, or how many events there are.

## Actions

- `explain` (light, app-wide): proposes a question that explains one event in a few short paragraphs. Vars: `year`, `text` (the first 200 characters). The agent only explains: it changes nothing outside the app without asking.

## Permissions

- Host: api.wikimedia.org — Wikimedia's public On this day feed (no key)
- Tasks — "Explain this event" proposes a light question, which the person starts

## Decision log

- 2026-10-28: the fixtures are hand-made, synthetic events for 1901–1925 (exactly one round anniversary in any year), because tests never use the network. Verify stays open until someone runs `humanharness plugin record events` once against the real feed.
- 2026-10-28: earlier days' round items are resolved from the stored list before it is replaced, rather than kept in a `seen` collection.
- 2026-10-28: the plugin starts off (`plugins.bundled`, not `plugins.on`), so a normal demo run never reaches Wikimedia.
