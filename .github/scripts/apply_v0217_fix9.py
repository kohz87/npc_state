from pathlib import Path

path = Path('tests/compatibility-check.js')
text = path.read_text()

anchor = "const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');\n"
if anchor not in text:
    raise SystemExit('compatibility index source anchor missing')
if "const identity = fs.readFileSync(path.join(root, 'identity.js'), 'utf8');" not in text:
    text = text.replace(
        anchor,
        anchor + "const identity = fs.readFileSync(path.join(root, 'identity.js'), 'utf8');\nconst contextSource = `${index}\\n${identity}`;\n",
        1,
    )

old = """for (const symbol of st118Contract.context) {
    assert.match(index, new RegExp(`\\b${symbol}\\b`), `missing context contract symbol ${symbol}`);
}"""
new = """for (const symbol of st118Contract.context) {
    assert.match(contextSource, new RegExp(`\\b${symbol}\\b`), `missing context contract symbol ${symbol}`);
}"""
if old not in text:
    raise SystemExit('compatibility context assertion anchor missing')
text = text.replace(old, new, 1)
path.write_text(text)

Path(__file__).unlink()
print('v0.2.17 compatibility contract now checks index + identity runtime sources')
