# Changelog

## 0.2.17

- Owner-qualified chat identity prevents same-filename character and group conversations from sharing state.
- Legacy unqualified sidecars migrate only when active conversation lineage proves ownership; ambiguous legacy data remains recoverable.
- Branch ancestry is restricted to the same character/group owner.
- Destructive tombstones override stale live pointers after interrupted delete/retire operations.
- Successful unchanged hydration is marked clean so page-hide does not force a redundant whole-sidecar rewrite.
- Portrait assets are garbage-collected against live/branch-restorable NPC ids and permanent deletion tombstones.
- Branch checkpoint snapshots are adaptively compacted under a bounded serialized-character budget.
- Hydrated chat state uses bounded LRU-style eviction once pending writes, loads, and scans have settled.
- High-value manual dossier edits, imports, deletes, archive changes, and portrait changes start persistence immediately.
- Production CI returns to read-only, version-neutral verification after the ten-pass release gate.

## 0.2.16

- Release verification for the completed chat-identity and persistent-ownership hardening.
- Group chat identity is namespace-safe when SillyTavern exposes both groupId and chatId.
- Stale hydration is rejected through ownership epochs across delete and rename lifecycle races.
- Retired sidecars and recovery metadata prevent deleted or renamed state from being resurrected.
- Broken sidecars have an explicit non-destructive detach/recovery path.
- Cross-chat branch inheritance requires stronger user-authored provenance and uses a bounded branch index.
- Release candidate survived ten consecutive full hard-pass cycles before promotion.

# NPC State Changelog

## v0.2.15

### Chat identity, ownership, and recovery hardening

- Corrected SillyTavern group-chat keying so group conversations use `group:<group-chat-id>` even though the host also exposes `chatId`; existing v0.2.14 group state is migrated when safely matched to the active group lineage.
- Added per-key ownership epochs so hydration and sidecar writes that finish after delete, rename, reset, or ownership transfer are discarded instead of resurrecting stale state.
- Added durable retired sidecar markers, recovery-file metadata, and tombstones so failed physical deletes and renamed predecessor files cannot be auto-recovered as live dossiers.
- Added explicit **Detach Broken Sidecar** recovery for genuinely missing/corrupt pointed files while preserving the old pointer in recovery metadata.
- Strengthened cross-chat branch inheritance to require a longer shared prefix with at least two user-authored messages, and replaced all-library hydration with a bounded branch-index shortlist plus limited legacy discovery.
- Made rename namespace selection use the SillyTavern `CHAT_RENAMED` event payload rather than whichever chat happens to be active when the async handler resumes.
- Prevented transient character/group-pending identities from becoming durable state namespaces.
- Replaced the version-specific CI hardener with version-neutral Node 24 verification and release-consistency tests.

## v0.2.14

### Data-safety and runtime-affinity hardening

- Made successful hydration the only authority transition for sidecar-backed chat state; unhydrated fallback state is read-only.
- Added explicit load-error UI and Retry Load while blocking dossier mutations until hydration succeeds.
- Made chat rename transactional by writing and verifying the new-key sidecar before switching ownership.
- Drains coalesced automatic scans when a genuinely hung scan operation times out.
- Persisted bounded backfill retry metadata with cooldown and a three-attempt automatic cap.
- Bound editor and portrait workflows to their origin chat and rejected stale asynchronous portrait completion.
- Added permanent GitHub Actions CI and dedicated v0.2.14 hardening assertions.


## v0.2.13

### Runtime lifecycle hardening

- Gated dossier rendering and RP prompt injection on per-chat hydration readiness so unloaded state cannot briefly render or inject as authoritative empty state.
- Coalesced automatic scans that arrive while a scan is already active, preventing valid assistant turns from being silently dropped.
- Replaced branch-rescan polling retries with one pending scan per chat and deterministic drain after the active scan completes.
- Hardened rapid chat switching by rejecting stale asynchronous hydration and branch work after the active chat changes.
- Cleaned pending scan and hydration error state during chat deletion and preserved chat/group namespace isolation.
- Added regression coverage for hydration gating, busy automatic scan coalescing, and chat-affine async completion.
- Full hardening verification completed with 320/320 Node tests passing twice, plus syntax, SillyTavern 1.18 compatibility, runtime smoke, migration smoke, and package-layout checks.

## v0.2.12

### Social Graph / canonical identity resolution

- Added a hidden, branch-specific ID-backed Social Graph for durable NPC-to-NPC kin, friend, rival, mentor, partner, guardian, and other established social edges. `Key Relationships` remains the compact max-five dossier/runtime projection rather than the database.
- Identity promotion now cascades through structured references: `Thunderbird -> Mina` preserves `Thunderbird` as an alias while neighboring `Thunderbird — clone sister` entries rewrite to canonical `Mina — clone sister` and duplicate alias/canonical entries collapse to one richer relationship.
- Added conservative repair for already-split interim/proper dossiers when explicit alias evidence proves they are the same person. The older stable dossier id survives, relationship history is retained, and graph endpoints are remapped. Ambiguous shared aliases never auto-merge.
- Added unresolved family slots for explicit/countable unnamed relations such as `two daughters`, `a daughter`, `twin daughters`, and `mother of two daughters`. Slots support partial later resolution, descriptors such as older/younger when locally grounded, twin-group metadata, and no guessing from an unrelated proper name.
- Named family introductions resolve existing slots into stable NPC ids. Shared established parents infer generic sibling edges; twin groups infer `twin sibling` without inventing older/younger birth order or biological/adoptive status.
- Social edges keep provenance/confidence/source metadata (`manual`, `explicit`, `strong-context`, `migration`, `inferred`). Manual Key Relationship edits update/remove matching graph edges deterministically.
- Death/archive keeps the social edge and projects an explicit deceased note; hard-pruned/deleted dossiers cannot leave dangling hidden ids. Manual UI deletion and OOC/story removal also purge stale structured references while preserving ordinary historical prose in memories/background.
- Graph state round-trips through sidecars, binary bundles/import, exact sibling swipe snapshots, branch roots, and legacy migration. Bundle import remaps graph endpoints onto an existing stable dossier id when identities merge.
- Runtime salience can use hidden graph counterparts even when a bond is outside the visible top-five Key Relationships, while generation still receives only confirmed-present NPC dossiers and never sees unresolved slots, graph ids, provenance, or graph machinery.
- Large-family inferred sibling expansion is bounded and lower-priority than explicit edges, preventing inferred pairwise links from crowding authoritative social facts.
- Settings schema advances to v24. Existing v0.2.11 dossiers migrate Social Graph state from resolvable Key Relationships/background family facts without changing visible relationship meters, milestone history, custom tuning, or exact swipe history.

## v0.2.11

### Relationship milestones / exact sibling swipes

- Added directional relationship milestone gates at `25/50/75/90` for every axis and polarity. Hidden fractional evidence cannot bank outward progress through a locked checkpoint, and movement toward neutral is never gate-blocked.
- Stock crossing requirements are semantic plus weighted: 25 needs meaningful evidence, 50 major, 75 extreme, and 90 extreme with substantial raw evidence; minimum raw evidence prevents a tiny `+1` mislabeled extreme from unlocking a near-maximum band.
- Milestone audit entries persist axis, polarity, threshold, reason, source message, turn, and inferred status. Previously crossed milestones remain historically unlocked; manual/imported established scores infer already-passed directional milestones without changing visible relationship numbers.
- Relationship Summary validation now respects milestone depth, so prose cannot claim deepest/absolute trust, exceptional attachment, or equivalent depth while the corresponding checkpoint remains locked. Checkpoint-blocked evidence may remain in recent dedupe history but no longer overwrites Last Relationship Change when nothing actually changed.
- Replaced one-checkpoint-per-message swipe persistence with content-lineage sibling snapshots. Revisiting a previously scanned swipe restores its exact NPC state without an LLM rescan; unseen siblings restore a parent/root anchor, scan once, then become independently restorable.
- Branch identity no longer depends on `swipe_id`, so deleting an alternate and renumbering remaining swipes does not invalidate their narrative state. New lineage keys use a two-lane content fingerprint, and v0.2.10 swipe-index fingerprints migrate only after full-prefix verification against the loaded chat.
- Added a pre-message root anchor for first/greeting swipes and prevented provisional pre-scan turn checkpoints from masquerading as completed exact sibling states.
- Made inline NPC cards lineage-specific and added bounded branch pruning that protects the active lineage/recent sibling heads while allowing very old siblings to fall back safely to one rescan after eviction.
- Added a branch/state revision guard for asynchronous scans and separated permanent manual UI deletion suppression from narrative snapshots so old swipes cannot resurrect explicitly deleted dossiers. Explicit Add/import can intentionally lift that suppression.
- Preserved portraits and user-managed dossier metadata across narrative restoration; milestone/progress/evidence/root/sibling state now round-trips through sidecars, bundles/imports, and branch rollback.
- Settings schema advanced to v23. Existing visible relationship scores and custom tuning remain unchanged.

## v0.2.10

### Relationship weighting / evidence accumulation

- Reduced stock raw event weights to `1/2/5/10` for ordinary/meaningful/major/extreme; `10` is the absolute stock single-event evidence ceiling, not a guaranteed visible gain.
- Replaced forced minimum-one-point inertia with per-axis fractional evidence accumulation. Deepening established scores now genuinely slows from 100% weight below 30 to 10% at 95+, while the displayed meter remains integer.
- Added resilience to small contrary events at established scores; extreme contrary evidence can still apply at full raw tier strength.
- Added per-axis `relationshipEvidence`; every moved axis must be grounded in the current exchange. Desire additionally requires explicit attraction/romantic/intimate/physical evidence in the narration itself.
- Added a six-event relationship evidence history so semantic deduplication survives intervening events instead of remembering only the most recent award.
- Rejected ambiguous tied overflow when a weak model proposes more equal-sized axes than the impact tier allows, avoiding fixed Trust/Affection tie bias.
- Relationship Summary updates now require a newly accepted relationship event once a summary already exists; duplicate/rejected events cannot advance prose. Unsupported romance/possessive/obsessive/dependency claims are rejected when the state does not support them.
- Removed raw relationship meter numbers and duplicate Relationship Summary injection from RP generation. Generation receives one compact qualitative relationship lens after Identity, Agency/other bonds, and Current State.
- Fractional progress and recent evidence history persist through dossiers, sidecars, bundles, imports, and branch checkpoints. Manual relationship edits clear stale fractional remainder on edited axes.
- Corrected relationship prompt examples to the `1/2/5/10` scale and broadened natural evidence inflections such as `trusts`, `relies`, `cares`, and `loves` without weakening axis grounding.
- Settings schema advanced to v22. Untouched v0.2.8/v0.2.9 stock caps/rubrics migrate forward; customized tuning and existing visible relationship scores remain unchanged.

## v0.2.9

### Relationship inertia / identity dominance

- Slowed stock relationship caps from `4/8/15/25` to `1/3/8/20` for ordinary/meaningful/major/extreme events. Existing customized caps are preserved during migration.
- Routine continuation, expected friendliness/care, ordinary companionship, and aftermath of an already-scored event now default to no numeric relationship change.
- Added axis-count limits: ordinary events affect at most one relationship axis, meaningful at most two, major at most three, and extreme at most four.
- Added relationship inertia when deepening an already-established polarity; high scores grow progressively harder to push toward ±100, while contrary evidence can still pull a score back toward neutral at full tier strength. Major/extreme events bypass much of that inertia.
- Added recent-event deduplication using grounded reason similarity plus recency, preventing the same rescue/confession/favor/intimacy/argument from being rewarded across its immediate aftermath. Same message IDs alone are never treated as duplicates, preserving swipe/edit correctness.
- Raised runtime relationship behavior thresholds from ±20/±60 to ±30/±70 and stopped emitting four neutral-axis explanations for low-score relationships.
- Reworked generation injection order to `Identity -> Agency/other bonds -> Current state -> Player relationship`, with player relationship explicitly marked as a secondary modifier. Relationship guidance budget was reduced while identity/agency/live-state budgets were increased.
- Moved durable Relationship Summary later in optional injection and removed relationship magnitude from runtime NPC salience so high-affection NPCs do not win prompt space merely because of their scores.
- Added first-name relevance for established multi-token names so `Falia` still finds `Falia Rendel` without restoring relationship-score salience.
- Focused relationship evaluation now receives Speech, Mannerisms, and last scored relationship event in addition to Personality, Behavioral Profile, Goal, and non-player bonds.
- Settings schema advanced to v21; untouched v0.2.8 stock relationship caps/rubrics migrate to the slower defaults while customized tuning remains authoritative.

## v0.2.8

### Canon hygiene / semantic consistency

- Added final write-time canon hygiene for scanner/import/refresh normalization without adding new dossier fields or changing schema v20.
- Apparent Age now canonicalizes English number words and decade prose (`around six`, `Twenties`, `early/mid/late thirties`) into stable seeded `~N` values; unparseable prose is rejected instead of persisted.
- Unlocked Appearance drops redundant leading explicit-age wording so the structured Apparent Age field remains authoritative for portrait age.
- Relationship summaries soften unsupported absolute dependency/devotion language at modest relationship scores.
- Every generated non-zero relationship delta requires a grounded relationshipChangeReason; unsupported deltas are discarded. Manual relationship adjustments remain exempt and authoritative.
- Behavioral Profile normalization rejects PC/intimacy/one-scene target-specific rules from global identity and compacts overlapping families such as Conflict/Anger/Composure.
- Repetitive mannerism animations are compacted by behavioral pattern; paperwork thrust/slap/flick variants become one durable handling habit.
- Ambiguous Key Relationship death suffixes are rewritten with explicit surviving/deceased subjects.
- Scanner importance is ignored for durable dossier state; Importance remains user/manual metadata while runtime prompt selection uses contextual salience.
- Updated scanner/backfill/import/refresh relationship contracts to preserve prior hard-pass safeguards while routing temporary/player-specific observations to the correct layer.
- Added Noctis-derived regression fixtures covering Brina, Liza/Tessa, Maren, and Jonas semantics.

## v0.2.7

### Final adversarial hard pass

- Added explicit boolean coercion for scanner and persisted flags, including legacy `clear*` / `evolve*` shorthands; quoted `"false"` no longer acts true.
- Invalid relationship scores/caps and scanner importance now fall back safely instead of being clamped into unintended extremes.
- Negated morality phrases such as `never cruel` no longer weaken kind/cruel polarity protection.
- Short-name relevance uses whole normalized phrases, preventing collisions such as `May` matching `maybe`.
- Key Relationship evolution merges named counterparts and preserves omitted unrelated bonds; prompt contracts now match that behavior.
- High-resolution portrait data is deduplicated in sidecar persistence, with the live dossier portrait authoritative over stale asset copies.
- Bundle import counts only active dossiers against the roster cap, preserving archived history without consuming active slots.
- Blank Personality, Speech, and Appearance require grounded narration or repeated supporting evidence before first durable seeding; first Mannerisms require recurrence or repeated evidence.
- Repeated evidence must support the proposed trait before it can seed a blank durable field.
- In-flight scans are discarded when dossier state changes while generation is pending, preventing stale model output from overwriting newer manual/import edits.
- Settings schema advanced to v20; existing supported sidecars remain compatible.

## v0.2.6

### Deep hard-pass characterization safeguards

- Injection now reserves space for Personality, Behavioral Profile, Speech, Mannerisms, Role, current Goal, and Key Relationships before relationship prose/optional metadata, including at the 512-token minimum.
- Essential Behavioral Profile injection now compacts each rule to a short semantic head, preventing one verbose category from starving later Cruelty/Independence safeguards at the minimum budget.
- Stock relationship-to-behavior guidance is compiled to a smaller semantic rubric instead of consuming identity budget.
- Missing `developmentScale` now defaults to gradual; it can no longer silently authorize an immediate durable identity rewrite.
- Gradual evolution requires fresh evidence matching the same stable concept label across separate scans; unrelated/stale evidence cannot unlock a different trait.
- Explicit and batch development are grounded against the supplied narration. Explicit updates require a nearby lasting-change/correction cue rather than mere word overlap. Batch updates additionally require development tied to the narrated skipped period, so bare elapsed time plus an unrelated present-day behavior cannot be fused into character growth.
- `refine` is now continuity-checked. Generic morality flips and transition language such as `no longer`, `formerly`, `became`, and `increasingly` are rejected unless they travel through the real evolution channel.
- Kind-personality vs generic-cruelty conflicts are filtered from first-pass and refined Behavioral Profiles.
- New mannerisms require recurring/habit evidence or cross-scan confirmation; a one-scene gesture cannot become a permanent tell merely because the scanner calls it habitual.
- Focused relationship evaluation now receives compact identity, current goal, and non-player social bonds so relationship summaries do not treat the player as the NPC's only motive.
- Sidecar reads verify the embedded chat key; new sidecar filenames use a wider two-part fingerprint to reduce accidental cross-chat aliasing.
- Behavioral Profile labels now support Unicode category names.


## v0.2.5

### Identity-first characterization

- Personality, compact Behavioral Profile, Speech, and Mannerisms are now essential injection context and appear before player relationship stats.
- Replaced high-score romance prescriptions with narrow relationship semantics: Trust is not obedience, Affection is not devotion, Desire does not prescribe flirting/blushing, and Tension does not imply jealousy or tsundere-style denial.
- Added a target-general morality safeguard so affection toward the player does not reduce established kindness, empathy, professionalism, duties, or regard for other NPCs.
- High relationship scores no longer imply universal player priority, clinginess, possessiveness, jealousy, or abandonment of unrelated bonds.

### Compact Behavioral Profile

- Added an evolvable six-item Behavioral Profile with labeled point-form rules for disposition, expressiveness, independence, care, conflict style, cruelty/social baseline, and similar grounded behavior cues.
- Added viewer and dossier-editor support, manual locking, import/backfill/refresh support, persistence, snapshot/branch handling, and bounded scanner/injection context.
- Behavioral Profile is capped and shares the existing injection budget, keeping routine scanner overhead below the existing 7,200-character ceiling.

### Gradual character development

- Added `gradual`, `explicit`, and `batch` development scales for durable identity changes.
- Gradual evolution requires evidence carried across scans; multiple observations emitted from one scene cannot immediately rewrite a slow identity field.
- Explicit lasting change may update immediately when grounded.
- Batch evolution is allowed for time skips only when narration explicitly summarizes sustained development; bare time passage is rejected deterministically.
- Temporary mood, stress, intimacy, injury, or player-specific behavior is firewalled from global Personality, Speech, Mannerisms, and Behavioral Profile.

### Upgrade behavior

- Settings schema advanced to v19. Existing dossier data, portraits, locks, relationship scores, and branch history remain compatible.
- The untouched v0.2.4 stock behavior rubric auto-migrates to the safer identity-first default; customized behavior rubrics are preserved.
- Added regressions for high-affection identity priority, general kindness, compact behavior profiles, cross-scan gradual evolution, time-skip gating, and alternate scanner-output bypasses.

## 0.2.4

- Portrait imports now preserve up to 1536 px on the longest side instead of 512 px, keeping the expanded dossier viewer sharp on high-DPI phones, tablets, and desktop displays.
- Portrait encoding now starts at WebP/JPEG quality 0.88 and reduces quality adaptively only when necessary to stay within a bounded per-image storage budget.
- Stored portrait metadata now records the encoded width and height for easier diagnostics and future responsive-image handling.

## v0.2.4

### Semantic dossier compaction

- Reworked durable-profile reconciliation so Personality, Speech, Appearance, Background, Relationship prose, Mannerisms, Key Relationships, Important Memories, and rolling profile evidence are bounded summaries instead of append-only observation logs.
- Added semantic duplicate detection with concept aliases for common paraphrases, including repeated telepathic-link wording and equivalent recurring habits.
- Mannerisms now keep at most four distinct habits and collapse paraphrases of the same action without deleting genuinely different habits involving the same person.
- Key Relationships keep one compact entry per counterpart; repeated relation/dynamic wording updates that entry instead of adding another copy of the person.
- Important Memories and rolling profile evidence now semantically deduplicate paraphrases before retention.
- Durable fields have lower canonical hard caps, and scanner context uses still tighter per-field slices so full scans cannot feed oversized profiles back into themselves.
- Scanner, backfill, dossier-import, and targeted-refresh prompts now explicitly require CURRENT COMPACT SUMMARY output: one concept once, one counterpart once, one event once.

### Existing dossier migration

- Added a one-time durable-compaction state migration. Existing v0.2.2 and older sidecars are normalized and rewritten once on load while preserving explicit manual profile locks.
- Inline snapshots and branch checkpoints are compacted too, preventing a swipe/rollback from resurrecting old duplicated prose.
- The migration is versioned independently in chat state and is persisted through the sidecar writer.

### Validation

- Added regressions for duplicate telepathic-link traits, same-action/same-person Mannerisms, repeated full-scan refinements, paraphrased profile evidence/memories, one-entry-per-counterpart Key Relationships, and one-time sidecar compaction.
- Certified with 198/198 Node tests plus compatibility, runtime, and migration smoke checks.

## v0.2.2

### Correctness and durability

- Fixed a high-severity sidecar write race. A mutation made while `/api/files/upload` is pending can no longer be marked persisted by an older snapshot. Writes now use immutable snapshots and loop until the persisted version catches the latest in-memory state.
- Chat deletion now waits for any in-flight write before deleting the pointer and file, preventing a completed stale upload from resurrecting deleted chat data.
- Chat rename now loads/settles the old key, transfers cache and pointer state, clears old write/version bookkeeping, and refreshes the payload under the new key.
- Added `stale` to the exported archive-reason contract so the public constant matches the runtime lifecycle already supported by normalization and UI.

### Performance

- Replaced full-history `filter → map → filter → slice` transcript construction with a newest-first bounded walk that stops after the configured number of meaningful messages.
- Megumin dossier import now searches newest-first and stops at the latest matching `<New_NPC>` base, rather than scanning the entire chat after the answer is already known.
- Settings-only edits no longer mark the per-chat dossier state dirty or rewrite its sidecar. They persist only extension settings.
- Batched all historical settings migrations and normalization into one save per `getSettings()` pass instead of repeatedly saving once per schema step.
- Scoped recurring inline-watchdog DOM queries to `#chat` instead of searching the whole document.
- Built one current-NPC lookup map per portrait-gallery render instead of repeatedly scanning the roster for every card and count.

### Compaction and maintenance

- Removed the unused `scannerNpcMentioned` helper.
- Consolidated repeated debug NPC lookup code behind one `findNpcByIdOrName` helper.
- Consolidated simple settings checkbox/number/text listeners.
- Removed retired pre-gallery standalone-book, old inline-dossier, old editor-shell, and unused viewer-column CSS.
- Rewrote README, test report, and changelog around the current product instead of shipping a long duplicate history of every experimental release.
- Added `CODE-REVIEW.md` with findings, fixes, validation, and deferred low-risk refactoring notes.

### Validation

- Added regression coverage for in-flight mutation persistence, deletion during an in-flight upload, batched migrations, bounded transcript collection, newest-first dossier lookup, chat-scoped DOM queries, archive-reason parity, retired CSS removal, and settings-only write isolation.
- Certified from a clean extracted package with 193/193 Node tests plus compatibility, runtime, and migration smoke checks.

## v0.2.1

- Raised the Portrait Generator above the full-screen dossier layer on tablet/mobile.
- Closing the generator returns to the still-open dossier.
- No scanner, storage, or prompt-generation changes.

## v0.2.0

- Added native SillyTavern portrait generation using editable Positive/Negative prompts and `/imagine quiet=true`.
- Added global portrait themes, composition, prompt formats, optional Mood/Location, and per-NPC prompt overrides.
- Added review/regenerate/use-as-portrait flow without replacing the existing portrait until confirmed.

## v0.1 milestone history

- **v0.1.67:** bounded sparse portrait galleries on tablet/desktop.
- **v0.1.66:** responsive portrait-first dossier viewer for desktop, tablet, and phone.
- **v0.1.65–0.1.64:** relaxed prose spacing and structured dossier sections/action bar.
- **v0.1.63:** optional Full scan every turn with current-exchange relationship isolation.
- **v0.1.62–0.1.61:** active/archive/delete stale lifecycle, active roster cap, and Minor NPC cards.
- **v0.1.60–0.1.59:** present-cast portrait gallery and focused full-screen dossier viewer.
- **v0.1.58–0.1.56:** per-NPC Refresh from Chat and organic durable-profile refinement.
- **v0.1.55–0.1.50:** independent Key Relationship edges, explicit dossier import, and durable non-player social ties.
- **v0.1.49:** Megumin August 18 `<Blocks>` compatibility and in-card NPC State tab.
- **v0.1.48–0.1.44:** Age/Apparent Age evolution, Personality/Appearance/Speech/Mannerism lifecycles, Status lifecycle, and identity promotion.
- **v0.1.43–0.1.38:** scan latency, deletion UI, conservative role admission, full first-pass profiles, configurable Important Memory criteria, and JSON recovery hardening.
- **v0.1.37 and earlier:** persistent JSON sidecars, branch rollback, present/off-screen separation, bipolar relationships, portrait assets, import/export, and SillyTavern 1.18 extension packaging.
