from pathlib import Path
p = Path('tests/migration-smoke.mjs')
text = p.read_text(encoding='utf-8')
old = 'schemaVersion, 26)'
count = text.count(old)
if count < 1:
    raise SystemExit('no schemaVersion 26 assertions remained to update')
text = text.replace(old, 'schemaVersion, 27)')
p.write_text(text, encoding='utf-8')
print(f'updated {count} migration schema assertions to 27')
