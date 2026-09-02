from pathlib import Path
p = Path('tests/hardening-v0221.test.js')
text = p.read_text(encoding='utf-8')
p.write_text(text.rstrip() + '\n', encoding='utf-8')
print('normalized v0.2.21 final-review fixture whitespace')
