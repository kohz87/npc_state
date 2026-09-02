from pathlib import Path

# The generalized legacy migrator must run for ordinary character chats as well as groups.
index = Path('index.js')
text = index.read_text()
old = "if (getChatIdentity().kind === 'group' && !getChatIdentity().pending) {\n"
count = text.count(old)
if count != 2:
    raise SystemExit(f'expected two legacy-migration bootstrap guards, found {count}')
text = text.replace(old, "if (!getChatIdentity().pending && isCanonicalChatKey(getChatKey())) {\n")
index.write_text(text)

# Migration smoke now models a legacy chat whose narrative lineage actually proves ownership.
# This preserves the v0.2.17 contract: provable legacy state migrates; ambiguous state is not guessed.
path = Path('tests/migration-smoke.mjs')
t = path.read_text()
if "import { chatLineage } from '../branch.js';" not in t:
    marker = "import { pathToFileURL, fileURLToPath } from 'node:url';\n"
    if marker not in t:
        raise SystemExit('migration import anchor missing')
    t = t.replace(marker, marker + "import { chatLineage } from '../branch.js';\n", 1)

if 'const legacyChat = [' not in t:
    marker = "const legacyNpc = {\n"
    legacy = """const legacyChat = [
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Welcome to the old campaign.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I enter the guild.' },
    { is_user: false, is_system: false, name: 'Megumin', mes: 'Yunyun waits beside the notice board.' },
    { is_user: true, is_system: false, name: 'Kazuma', mes: 'I greet Yunyun.' },
];

"""
    if marker not in t:
        raise SystemExit('legacyNpc anchor missing')
    t = t.replace(marker, legacy + marker, 1)

target = "                }], portraitAssets: {}, checkpoints: [], lineage: [],\n"
if target not in t:
    raise SystemExit('legacy inline lineage anchor missing')
t = t.replace(target, "                }], portraitAssets: {}, checkpoints: [], lineage: chatLineage(legacyChat),\n", 1)

target = "    chatId: 'legacy-chat', getCurrentChatId: () => 'legacy-chat', chat: [],\n"
if target not in t:
    raise SystemExit('migration context chat anchor missing')
t = t.replace(target, "    chatId: 'legacy-chat', getCurrentChatId: () => 'legacy-chat', chat: structuredClone(legacyChat),\n", 1)
path.write_text(t)

# Let the final queued branch reconciliation settle before the runtime harness destroys its context.
path = Path('tests/runtime-smoke.mjs')
t = path.read_text()
marker = "    assert.notEqual(ownerAKey, ownerBKey);\n\n    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');"
if marker not in t:
    raise SystemExit('runtime cleanup anchor missing')
t = t.replace(marker, "    assert.notEqual(ownerAKey, ownerBKey);\n    await sleep(120);\n\n    console.log('Runtime smoke: file persistence, branch safety, OOC removal, chat cleanup, group ownership, and same-filename character isolation passed.');", 1)
path.write_text(t)

Path(__file__).unlink()
print('v0.2.17 character legacy migration and runtime cleanup fixed')
