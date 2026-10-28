# __NAME__

This is the template's example: a list of items from an example API. Run `/new-plugin` to replace it with your plugin, section by section.

## Purpose

Shows the items from api.example.com in a panel, with their count in a chip, so the person sees them without asking. Each item can be summarized by the agent.

## Sources

| Source | Brings | TTL |
|---|---|---|
| items | The list of items (id and title) | 15 min |

## Rules

None yet: the example raises no attention items.

## Panels

- Panel `main` (Items): the items as a table, with a Summarize button per row.
- Chip `count`: how many items there are.

## Actions

- `summarize` (light, app-wide): summarizes one item in two sentences. Var: `id`.

## Permissions

- Host: api.example.com — where the items come from.
- Tasks — the Summarize action proposes a task, which the person starts.

## Decision log
