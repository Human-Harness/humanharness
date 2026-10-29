# mock-tools

A test fixture: one action whose pre-step and agent call a tool that mock mode answers from `mock/tools/`.

## Task

Tell the person the sky over a city today, from a weather service.

## Decisions

The person picks another city after the first answer (show_choices).

## Flow

| Action | Tier | Cost | Purpose |
|---|---|---|---|
| forecast | standard | light | Tells the sky over Lima, then any other city |
| (questions) | light | – | Free questions |

## Mechanical work

| Moment | Code or AI | Tool or step | Why |
|---|---|---|---|
| Before Forecast starts | Code | weather (pre-step, as today) | The same request every time |
| When the person asks another city | AI calls code | weather | The AI picks the city; the tool fetches it |

## Context

Each closed task saves a note with the core `save_note` fields: a title, up to five summary points, the decisions taken, the files that back them and the questions left open.

## Models

- forecast: standard — one short answer.
- (questions): light — free questions are short.

## Permissions and engines

- edit: folder — the fixture keeps the default work folder edit.
- exec: false — no commands are needed.
- web: true — the weather tool reads api.weather.test (only ever from the recording in the tests).
- engines: claude

## Identity

Mock Tools, by Human Harness tests.

## Open questions

## Decision log
