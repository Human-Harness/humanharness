// The subjects of the history's commits: raw git data in English, written by the runtime, the task manager
// and the restores, and read back by the History panel (through i18n keys). Plain constants with no imports,
// so the renderer can use them (`@humanharness/workspace/subjects`, re-exported by `@humanharness/protocol`).

/** The runtime started: changes made outside the app. */
export const START = "Start";
/** The snapshot before each message: the person's own edits, not the AI's. */
export const BEFORE_MESSAGE = "Before message";
/** A turn that finished; the message's start follows. */
export const TURN_PREFIX = "Turn: ";
/** A turn that didn't finish; the message's start follows. */
export const STOPPED_PREFIX = "Stopped: ";
/** The point before a crashed turn, restored; the reason follows. */
export const UNDO_PREFIX = "Undo: ";
/** A turn's paths it shares with other running tasks (parallel spec §5.2): committed right after its own; the message's start follows. */
export const SHARED_PREFIX = "Shared: ";
/** The two restores. */
export const RESTORE_POINT = "Went back to an earlier point";
export const RESTORE_TASK = "Went back to before the task";
/** A saved note; its title follows. */
export const NOTE_PREFIX = "Note: ";
/** The subject of the commit that saves a task's note; group 1 is the note's title. */
export const NOTE = new RegExp(`^${NOTE_PREFIX}(.+)$`);
/** A change the person made to the harness's data; the collection's name follows. */
export const DATA_CHANGE_PREFIX = "Data: ";

/** A person's answer in a document review (reviews.md): `Answer: <path> · <question>`. */
export const ANSWER_PREFIX = "Answer: ";
/** Between an answer's path and its question. */
export const ANSWER_SEPARATOR = " · ";
/** A person's approval of a document (reviews.md): `Approved: <path>`. */
export const APPROVED_PREFIX = "Approved: ";
/** One file brought back to a version (file-timeline spec §5): `Go back: <path> to <target>`. */
export const FILE_RESTORE_PREFIX = "Go back: ";

/** The person pinned, unpinned, excluded or included something (context-panel spec §4): `Context: pinned <path>`. */
export const CONTEXT_CHANGE_PREFIX = "Context: ";
