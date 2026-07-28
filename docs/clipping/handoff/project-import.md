# Editable project import

The protected `/editor/handoff/{handoffId}` route performs a bounded bootstrap:
claim, validate, journal the import, write the exact v35 project, register all
descriptors, finish the local journal, complete the server handoff, and redirect
to `/editor/{targetProjectId}`.

The import does not rebuild or reorder scenes, tracks, elements, captions,
trims, playback rates, canvas settings, or provenance. Existing migrations run
when the project is later loaded through the normal store.

Collision policy:

- The same project and conversion identity is reused, including a new handoff
  for the same conversion. Existing edits are not overwritten.
- The same project ID with a different conversion identity returns
  `handoff_project_conflict`.
- A journal written before a crash is retryable. Missing project data is
  restored; attachment registration is replayed; server completion occurs only
  after local completion.
- Clone-on-conflict is deferred.

Chromium verification imports a real Stage 3.1 fixture, preserves schema,
element/media identity and project structure, edits the project name, saves and
reloads it, retains the descriptor, and finds no persisted access URL.

