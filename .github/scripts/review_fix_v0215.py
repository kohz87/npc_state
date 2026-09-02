from pathlib import Path
p=Path('branch.js')
s=p.read_text()
s=s.replace("        if (prefixLength < 2) continue;\n        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);", "        if (prefixLength < 1) continue;\n        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);")
p.write_text(s)

p=Path('tests/index-hardening.test.js')
s=p.read_text()
s=s.replace("test('manual trash removes narrative name suppression and branch inheritance accepts message zero',()=>{\n  assert.match(source,/const permanentLabels = new Set/);\n  assert.match(source,/working\\.dismissed = .*?working\\.dismissed/s);\n  assert.match(source,/chat\\.length < 1/);\n});", "test('manual trash removes narrative name suppression and branch inheritance requires user-authored provenance',()=>{\n  assert.match(source,/const permanentLabels = new Set/);\n  assert.match(source,/working\\.dismissed = .*?working\\.dismissed/s);\n  assert.match(source,/chat\\.length < 2/);\n  assert.match(source,/chat\\.some\\(message => message\\?\\.is_user\\)/);\n});")
p.write_text(s)

p=Path('tests/quality.test.js')
s=p.read_text().replace("functionBody(index, 'async function flushStateFile', '\\nfunction persist()')", "functionBody(index, 'async function flushStateFile', '\\nfunction persist(')")
p.write_text(s)
print('hard-pass review corrections applied')
