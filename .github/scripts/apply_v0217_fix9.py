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

loop_start = text.find('for (const symbol of st118Contract.context) {')
if loop_start < 0:
    raise SystemExit('compatibility context loop missing')
loop_end = text.find('\n}', loop_start)
if loop_end < 0:
    raise SystemExit('compatibility context loop end missing')
loop_end += 2
block = text[loop_start:loop_end]
if 'assert.match(contextSource,' not in block:
    if 'assert.match(index,' not in block:
        raise SystemExit('compatibility context assertion source missing')
    block = block.replace('assert.match(index,', 'assert.match(contextSource,', 1)
    text = text[:loop_start] + block + text[loop_end:]

path.write_text(text)
Path(__file__).unlink()
print('v0.2.17 compatibility contract now checks index + identity runtime sources')
