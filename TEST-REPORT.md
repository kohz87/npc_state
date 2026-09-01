# NPC State v0.2.8 Test Report

Target: SillyTavern 1.18.0 extension contract.

## Result

**PASS**

The reviewed working tree completed:

- **242/242 Node tests passed**
- SillyTavern 1.18 compatibility/import/event contract passed
- Megumin Suite isolation and master-block integration checks passed
- Mocked browser/runtime smoke passed
- Legacy settings and sidecar migration smoke passed
- One-level extension package-layout check passed

The bounded routine scanner fixture measured **7,127 non-story prompt characters**, below the existing 7,200-character ceiling.

## v0.2.8 canon-hygiene coverage

- Word-form and decade Apparent Age values normalize to stable `~N`; equivalent `Twenties` / `around twenties` wording does not reroll the same NPC.
- Unknown Apparent Age prose is rejected instead of persisted.
- Redundant explicit age in unlocked Appearance is removed while structured Apparent Age remains authoritative.
- Noctis-style low/moderate relationship summaries cannot retain `indispensable` dependency wording; Brina's fixture is reframed to `a growing source of practical support and comfort`.
- Generated relationship deltas with missing or story-ungrounded reasons are rejected; grounded reasons apply normally; manual audit deltas remain valid.
- PC/intimacy-specific Behavioral Profile rules do not become global identity canon.
- Overlapping Conflict/Anger/Composure profile rules compact into one reusable behavioral rule.
- Repeated paperwork gesture variants compact into one Mannerism.
- Ambiguous `(deceased)` Key Relationship wording is rewritten with an explicit surviving/deceased subject.
- Scanner importance cannot change durable Importance; new scanned dossiers keep neutral 50 while contextual salience controls prompt selection.
- Runtime smoke fixtures now require narrated evidence for relationship changes rather than silently accepting ungrounded deltas.
- Package version/schema expectations validate v0.2.8 / schema v20.

## v0.2.7 final hard-pass coverage

- Quoted scanner booleans (`"false"`) cannot mark presence, world activity, identity continuity, clearing, or evolution as true.
- Malformed relationship scores/caps fall back safely rather than normalizing to negative extremes.
- Negated morality wording such as `never cruel` preserves the established kindness guard.
- Short NPC names receive whole-phrase relevance only.
- Key Relationship evolution changes named counterparts without deleting omitted bonds.
- Sidecar portrait compaction stores high-resolution portrait bytes once and prefers the live NPC copy over a stale asset entry.
- Bundle roster caps count active dossiers while preserving archives.
- Blank durable Personality/Speech/Appearance cannot be seeded by an ungrounded first impression.
- First Mannerisms require recurrence or repeated cross-scan evidence.
- Repeated evidence can seed an empty trait only when it supports the proposed trait.
- Runtime smoke covers stale in-flight scan discard after dossier state mutation.
- Historical v0.2.7 migration/persistence contracts remain covered; current package version is v0.2.8 with schema v20.

## v0.2.6 hard-pass coverage

- Minimum 512-token injection preserves all established identity channels plus Role, current Goal, and Key Relationships.
- Minimum-budget Behavioral Profile compaction preserves high-priority categories such as Disposition, Cruelty, and Independence even when individual rules are verbose.
- Missing `developmentScale` cannot authorize immediate evolution.
- Gradual evolution requires the same labeled pattern across separate scans; unrelated evidence is rejected.
- Personality/Speech/Behavioral Profile transition-language smuggling through `refine` is rejected.
- Generic cruelty cannot be added to a broadly kind personality through refinement or contradictory first-pass behavior extraction.
- One-off gestures cannot become recurring mannerisms when source narration does not establish recurrence.
- Batch development is rejected when the model invents development over bare elapsed time, and accepted when the actual time-skip narration establishes the change.
- Explicit evolution requires a nearby lasting-change/correction cue in source narration; shared vocabulary from a one-off act is insufficient. Batch evolution cannot borrow unrelated present-day evidence from elsewhere in the transcript.
- Focused relationship prompts include identity, goals, and non-player bonds.
- Sidecar reads reject valid NPC State payloads belonging to a different chat.
- Behavioral Profile category parsing accepts Unicode labels.

## v0.2.5 identity/evolution coverage

- Identity core is injected before relationship stats and includes the compact Behavioral Profile when available.
- High Trust/Affection/Desire/Tension cannot silently replace identity with generic romance/tsundere behavior.
- General kindness/empathy survives high player affection; necessary force is explicitly separated from gratuitous cruelty.
- Behavioral Profile category dedupe and six-item cap are enforced.
- Gradual durable evolution requires evidence carried across scans; one scan cannot self-supply enough evidence to rewrite identity.
- A bare time skip cannot batch-rewrite Personality, while an explicit skipped-period development summary can.
- The ordinary NPC-delta merge path cannot bypass the gradual evidence gate.
- Untouched v0.2.4 stock behavior-rubric detection is exact enough to preserve customized user rubrics.

## v0.2.4 semantic-compaction coverage

### Durable dossier reconciliation

- Duplicate telepathic-link descriptions collapse to one durable concept during normalization.
- Paraphrases of the same mannerism collapse while distinct habits involving the same counterpart remain separate.
- Repeating the same full-summary refinement across multiple scans produces a stable result instead of growing the field each turn.
- Rolling profile evidence and Important Memories semantically deduplicate paraphrased observations/events.
- Key Relationships keep one compact entry per counterpart.
- Existing pre-v0.2.4 sidecars are compacted once, assigned a durable-compaction version, and rewritten through the normal race-safe sidecar writer.
- Inline cards and branch-checkpoint NPC snapshots are normalized so rollback cannot restore old bloat.

### Prompt and storage bounds

- Auto-managed durable fields have canonical hard caps before persistence.
- Stable-profile scanner context applies tighter per-field slices than storage, preventing an oversized legacy/manual dossier from consuming the full scan prompt.
- Scanner/backfill/refresh contracts require CURRENT COMPACT SUMMARY output with one concept, counterpart, and event represented once.

## Retained v0.2.2 review coverage

### Sidecar durability

- Delays the first sidecar upload, mutates the same NPC while that upload is pending, and verifies a second immutable snapshot persists the final state.
- Deletes a chat while an upload is blocked, then verifies the completed old upload cannot recreate its pointer or sidecar.
- Exercises rename transfer after pending state has been loaded and settled.

### Settings write isolation

- Migrating an older settings schema performs one consolidated settings save rather than one save per historical schema step.
- Checkbox, number, and text settings controls use settings-only persistence and do not dirty/rewrite the current chat sidecar.
- Dossier, portrait, branch, archive, and relationship mutations continue to use the state-persistence path.

### Bounded work on long chats

- Recent transcript extraction walks backward and stops after the configured number of meaningful messages rather than cleaning every message in the chat.
- Megumin dossier lookup searches newest-first and stops at the latest matching `<New_NPC>` base while retaining relevant later updates.
- Recurring inline reconciliation is scoped to the chat root instead of the whole document.
- Portrait-gallery rendering uses one current-NPC lookup map per pass.

### Contract and compaction guards

- `NPC_ARCHIVE_REASONS` includes the runtime-supported `stale` reason.
- Removed helpers and retired CSS generations are asserted absent.
- Current portrait gallery, responsive dossier viewer, Portrait Generator layering, Megumin tab integration, mobile touch isolation, and bounded tablet cards remain covered.
- Package tests require the current README, changelog, code-review report, and test report at the extension root.

## Retained functional coverage

The suite continues to cover:

- NPC admission, identity promotion, aliases, Minor NPC visibility, active roster limits, and stale archive/delete lifecycle
- Personality, Speech, Appearance, Mannerisms, Age/Apparent Age, Status, Mood, Goal, Location, Background, Important Memories, and Key Relationships
- Trust/Affection/Desire/Tension deltas, relationship prose synchronization, replay prevention, focused repair, and branch rollback
- quick scans, full scans, targeted dossier import, Refresh from Chat, durable-profile evidence accumulation, and malformed-JSON recovery
- present versus off-screen semantics for narration, World State, and NPC Inner Chatter
- Megumin August 18 `<Blocks>` parsing, in-card tab mounting, redraw reattachment, native tab handoff, and standalone fallback
- native SillyTavern `/imagine quiet=true` portrait generation, Positive/Negative prompt building, preview, regeneration, and use-as-portrait confirmation
- portrait compression/assets, `.npcstate` import/export, corrupt-bundle rejection, sidecar migration, archive/reactivation, chat rename/delete, swipes, edits, and inherited branches

## Review boundary

The automated environment mocks SillyTavern's browser, file API, slash-command bridge, and image-generation responses. It does not exercise the user's exact theme, mobile browser gesture stack, Stable Horde queue behavior, checkpoint availability, or third-party extension combination. Those remain deployment checks in the real installation.
