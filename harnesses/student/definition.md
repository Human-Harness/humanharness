# Student harness — functional definition

Status: draft v1, 2026-11-16. Sources: discovery interview rounds 1–3 (2026-10-20, `docs/discovery/2026-10-20-harness-discovery.md` on branch `worktree-harness-discovery`), prototype and mockups there, and the `socrates-app` workspace. Decisions below marked **[Marco 2026-11-16]** were taken in this session.

## 1. What it is

An installable app for **studying**: learn a topic, prepare for an exam. It is the evolution of `socrates-app` (Socratic method becomes one of seven methods). It connects to nothing else (not to the teacher harness).

Out of scope: doing homework, producing documents for the student, dates/calendars, an adult feature (an adult only accompanies; the app suggests, never enforces, adult company for minors).

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | All ages. The learner states age; level and tone adapt. | interview |
| D2 | v1 = the whole prototype: 7 methods, map, flashcards, spaced review, material, onboarding interview. | **Marco 2026-11-16** |
| D3 | One learner profile per install in v1. Several profiles later (core profiles support it). | **Marco 2026-11-16** |
| D4 | Built on the merged core pieces (scopes + data store, settings, input blocks, task phases/time box, setup steps, profiles, material processing), not on private files. Before the spec's plan: verify each piece still exists after the minimal-core/mods spec. | **Marco 2026-11-16** |
| D5 | Mastery needs evidence on 2 different days; review by growing intervals (1, 3, 7, 14 days) adjusted by performance. | **Marco 2026-11-16** |
| D6 | The tutor speaks the learner's language, chosen in the profile; topic content is stored in that language. App ships English, UI translated on demand (language-on-demand spec). | **Marco 2026-11-16** |
| D7 | Help ladder: never gives the answer directly; hint → stronger hint → explanation, thresholds per profile (default 2 / 3 as in Sócrates). | **Marco 2026-11-16** |
| D8 | Start from zero: no import of the `ia/` subject from socrates-app. | **Marco 2026-11-16** |
| D9 | Visual style "Mañana" (paper sheet, Geist + Newsreader, light/dark). Layout "study IDE" (v3) still to be reviewed; UI follows the Radix + Impeccable spec. | interview + CLAUDE.md |

## 3. Objects

- **Profile**: name, age band, language, how I learn (from the onboarding interview), tutor tone (patient / neutral / demanding), explanation length, hint and explanation thresholds, questions per message.
- **Topic** (the scope): title, why, level for this topic, what I already know, strict/mixed grounding, material, map, sessions, summaries, flashcards, glossary, open questions.
- **Concept** (map node): name, prerequisites, source tag (from my material / added by the AI), state, evidence list, "this is hard for me" flag.
- **Concept states**: not seen → seen → practising → mastered → review due. Up only with evidence (D5): correct recall on 2 different days; a Feynman explanation without gaps; an exercise solved without hints. The learner cannot mark mastered; can flag "hard". Mastered drops to review due by interval.
- **Flashcard**: written by the learner, corrected by the AI; linked to a concept; 4 ratings (again / hard / good / easy) set the next interval; review interleaves topics.
- **Summary**: written by the learner at session close, corrected by the AI inline.
- **Topic note** (from Sócrates): the learner's real answers, including wrong ones; open questions; glossary entries (by abstraction level where the topic has levels).
- **Material**: processed by the core (text-only files, confirmed text, material sheet, concept ↔ fragment links, per-session loading, citations). The harness declares what the sheet extracts (terms, notation, examples, exercises) and that items are map concepts.

## 4. Flows

1. **First run**: core setup (folder, engine) → who studies (name, age band; under 18 shows "study with an adult") → onboarding interview, 6 questions one at a time with a live "what the app understands about you" panel → profile saved.
2. **Home**: "For today" (due reviews + next concept whose prerequisites are done), topic cards with mastery bar, flashcards due.
3. **New topic**: what, why, level, what I know, optional material, strict/mixed → AI proposes the map (prerequisite columns, tagged by source) → optional 5-question diagnosis, or start from zero; learner confirms the map.
4. **Topic view**: map with states; concept detail (evidence, what is missing, my summary, flashcards); tabs: summaries, flashcards, material, sessions, open questions.
5. **Start session**: goal (concepts from the map, exam prep over a set, or free); optional time box 15/30/45 min; the AI recommends a method with reasons; the other six are listed; learner picks.
6. **Session** (phases): warm-up recall over due items (2–3 questions) → main block with the chosen method → close (learner writes a summary and flashcards for what was new; AI corrects) → end screen (what changed in the map with evidence, an open question, what is next). Method switchable mid-session; the time box ends with a quiet wrap-up turn.
7. **Flashcard review**: answer from memory, the AI checks, learner rates; interleaved across topics.
8. **Profile / settings**: edit how I learn and tutor settings; per-method settings; usage tab is core.
9. **Add material later**: processed by the core; map changes proposed, learner confirms.

## 5. Methods (all 7 in v1)

| Method | Shape | Help rule |
|---|---|---|
| Socratic | Pre-exercise first (prediction, design, thought experiment, counterexample, real experiment, order/classify), then one question per message; no answer before the learner commits | D7 ladder, strict |
| Feynman | Learner explains; AI highlights ok/gap with notes | Points at gaps, does not fill them until asked |
| Retrieval practice | Active recall + flashcards, spaced | Hint ladder |
| Worked examples with fading | Examples with steps progressively removed | Shows the solved steps by design; learner completes the faded ones |
| Elaboration | Why / how does it connect, links to earlier concepts | D7 ladder |
| Interleaved practice | Mixed problems across concepts/topics | D7 ladder |
| Problem-based | Start from a realistic problem, build the concepts needed | D7 ladder |

The AI recommends from topic + profile and explains why; the learner always decides.

## 6. Grounding

- **Strict**: only the material; the AI cites the fragment ("your notebook, p. 2") and says when something is not there.
- **Mixed**: material and AI knowledge are marked apart.
- When material and AI disagree (notation, a teacher's method), follow the material and flag the difference; never correct silently.
- No material: the AI's own knowledge, marked as such.

## 7. Core needs and gaps to verify (D4)

Uses: scopes + data store (map, flashcards, evidence), settings schema (profile tone, thresholds, per-method), input blocks (summary, flashcards, exercise "commit", options), task phases + time box, setup steps (interview), profiles, material processing, language on demand.

To check against current master before planning: spaced-repetition scheduler (core utility or harness code?), evidence-based state model (generic "items with state + evidence" is only a candidate), block for user-authored text with inline AI notes, session frame with live evidence panel.

## 8. Parked

- Layout "study IDE" v3 review and its open questions (does a small chat still work for Socratic/Feynman? sources column collapsed?). Needs option mockups.
- Legal check for minors using a personal AI subscription (the account holder is an adult; confirm wording of the "study with an adult" notice) — ask the `cockpit:abogado` agent before distribution.
- Several profiles per install.
