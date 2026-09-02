from pathlib import Path

path = Path('index.js')
text = path.read_text()
old = """        delete settings.dataFiles[oldKey];
        delete settings.branchIndex[oldKey];
        if (settings.chats?.[oldKey]) delete settings.chats[oldKey];
        chatStateCache.delete(oldKey);"""
new = """        delete settings.dataFiles[oldKey];
        delete settings.branchIndex[oldKey];
        if (settings.chats?.[oldKey]) delete settings.chats[oldKey];
        if (settings.chats && Object.keys(settings.chats).length === 0) delete settings.chats;
        chatStateCache.delete(oldKey);"""
# There are rename + legacy migration blocks with this shape. The generalized migration is the
# final occurrence, and applying the cleanup to both is safe and desirable.
count = text.count(old)
if count < 1:
    raise SystemExit('legacy settings cleanup anchor missing')
text = text.replace(old, new)
path.write_text(text)

Path(__file__).unlink()
print('v0.2.17 empty legacy settings cleanup applied')
