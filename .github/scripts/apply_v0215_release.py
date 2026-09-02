from pathlib import Path
import json, re

p = Path('index.js')
s = p.read_text()

# Correct SillyTavern identity: group context also exposes chatId, so group must win.
s = s.replace("    if (raw) return `chat:${raw}`;\n    if (ctx.groupId !== undefined && ctx.groupId !== null) return `group:${ctx.groupId}`;", "    if (ctx.groupId !== undefined && ctx.groupId !== null) {\n        const groupChatId = raw || ctx.groupId;\n        return `group:${groupChatId}`;\n    }\n    if (raw) return `chat:${raw}`;")

# Per-key ownership epochs invalidate stale hydration after delete/rename/reset.
s = s.replace("const hydrationErrors = new Map();", "const hydrationErrors = new Map();\nconst chatOwnershipEpochs = new Map();")
s = s.replace("function chatHydrationStatus(key = getChatKey()) {", "function chatOwnershipEpoch(key) { return Number(chatOwnershipEpochs.get(key) || 0); }\nfunction invalidateChatOwnership(key) {\n    if (!key || key === 'no-chat') return 0;\n    const next = chatOwnershipEpoch(key) + 1;\n    chatOwnershipEpochs.set(key, next);\n    return next;\n}\nfunction assertChatOwnership(key, epoch) {\n    if (chatOwnershipEpoch(key) !== epoch) throw new Error('NPC State chat ownership changed while data was loading.');\n}\n\nfunction chatHydrationStatus(key = getChatKey()) {")
s = s.replace("    const task = (async () => {\n        const settings = getSettings();", "    const hydrationEpoch = chatOwnershipEpoch(key);\n    const task = (async () => {\n        const settings = getSettings();")
s = s.replace("                    const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });\n                    if (payload?.state) loaded = payload.state;", "                    const payload = await readNpcStateDataFile(pointer, { expectedChatKey: key });\n                    assertChatOwnership(key, hydrationEpoch);\n                    if (payload?.state) loaded = payload.state;")
s = s.replace("                const recovered = await readNpcStateDataFile(recoveryPointer, { expectedChatKey: key });\n                if (recovered?.state) {", "                const recovered = await readNpcStateDataFile(recoveryPointer, { expectedChatKey: key });\n                assertChatOwnership(key, hydrationEpoch);\n                if (recovered?.state) {")
s = s.replace("        const sourceState = loaded || legacy || freshChatState();", "        assertChatOwnership(key, hydrationEpoch);\n        const sourceState = loaded || legacy || freshChatState();")

# Tombstones stop deterministic recovery from reviving intentionally retired keys.
s = s.replace("    if (!settings.dataFiles || typeof settings.dataFiles !== 'object') assign('dataFiles', {});", "    if (!settings.dataFiles || typeof settings.dataFiles !== 'object') assign('dataFiles', {});\n    if (!settings.retiredChatKeys || typeof settings.retiredChatKeys !== 'object') assign('retiredChatKeys', {});")
s = s.replace("        if (!pointer?.path && (key.startsWith('chat:') || key.startsWith('group:'))) {", "        if (!pointer?.path && !settings.retiredChatKeys?.[key] && (key.startsWith('chat:') || key.startsWith('group:'))) {")
s = s.replace("    scanOperations.cancel(key, 'chat-deleted');", "    invalidateChatOwnership(key);\n    settings.retiredChatKeys = settings.retiredChatKeys && typeof settings.retiredChatKeys === 'object' ? settings.retiredChatKeys : {};\n    settings.retiredChatKeys[key] = { retiredAt: Date.now(), reason: 'deleted' };\n    scanOperations.cancel(key, 'chat-deleted');")
s = s.replace("    const oldKey = `${currentPrefix}${oldId}`;\n    const newKey = `${currentPrefix}${newId}`;", "    const eventGroupId = eventData.groupId;\n    const eventPrefix = eventGroupId !== undefined && eventGroupId !== null ? 'group:' : currentPrefix;\n    const oldKey = `${eventPrefix}${oldId}`;\n    const newKey = `${eventPrefix}${newId}`;")
s = s.replace("        // Phase 2: switch ownership only after the new sidecar can be read under the new key.\n        settings.dataFiles[newKey] = newPointer;", "        // Phase 2: switch ownership only after the new sidecar can be read under the new key.\n        invalidateChatOwnership(oldKey);\n        settings.retiredChatKeys = settings.retiredChatKeys && typeof settings.retiredChatKeys === 'object' ? settings.retiredChatKeys : {};\n        settings.retiredChatKeys[oldKey] = { retiredAt: Date.now(), reason: 'renamed', successor: newKey };\n        delete settings.retiredChatKeys[newKey];\n        settings.dataFiles[newKey] = newPointer;")

# Migration compatibility for group states previously mis-keyed as chat:<group chat id>.
s = s.replace("        const state = key === 'no-chat' ? null : getChatState(key);", "        if (key.startsWith('group:') && !getSettings().dataFiles?.[key] && !getSettings().chats?.[key]) {\n            const legacyWrongKey = `chat:${key.slice(6)}`;\n            if (getSettings().dataFiles?.[legacyWrongKey] || getSettings().chats?.[legacyWrongKey] || chatStateCache.has(legacyWrongKey)) {\n                const legacyState = await ensureChatStateLoaded(legacyWrongKey);\n                if (getChatKey() !== key) return;\n                setChatState(key, structuredClone(legacyState), { markLoaded: true });\n                await flushStateFile(key);\n                getSettings().retiredChatKeys[legacyWrongKey] = { retiredAt: Date.now(), reason: 'group-key-migrated', successor: key };\n                delete getSettings().dataFiles[legacyWrongKey];\n                chatStateCache.delete(legacyWrongKey); loadedChatKeys.delete(legacyWrongKey);\n                persistSettings();\n            }\n        }\n        const state = key === 'no-chat' ? null : getChatState(key);")

# Version.
s = s.replace("/* NPC State v0.2.14", "/* NPC State v0.2.15")
p.write_text(s)

core = Path('core.js')
c = core.read_text().replace("NPC_STATE_VERSION = '0.2.14'", "NPC_STATE_VERSION = '0.2.15'")
core.write_text(c)

manifest = json.loads(Path('manifest.json').read_text())
manifest['version'] = '0.2.15'
Path('manifest.json').write_text(json.dumps(manifest, indent=4) + '\n')

# Release docs.
for name in ['README.md','CODE-REVIEW.md','TEST-REPORT.md']:
    q=Path(name)
    if q.exists(): q.write_text(q.read_text().replace('v0.2.14','v0.2.15'))
ch=Path('CHANGELOG.md')
text=ch.read_text()
entry='''# Changelog\n\n## 0.2.15\n\n- Corrected SillyTavern group-chat identity so group namespaces win when both `groupId` and `chatId` are present.\n- Added migration for group dossiers previously persisted under the legacy `chat:<group-chat-id>` namespace.\n- Added per-chat ownership epochs so stale hydration cannot repopulate state after deletion or rename.\n- Added retired-key tombstones to prevent deterministic sidecar recovery from resurrecting deliberately deleted or renamed chat state.\n- Bound rename namespace selection to event-provided group identity when available.\n- Hardened release CI with ten consecutive full-suite passes.\n\n'''
if text.startswith('# Changelog\n'): text=entry+text[len('# Changelog\n\n'):]
else: text=entry+text
ch.write_text(text)
