from pathlib import Path
p=Path('branch.js')
s=p.read_text()
s=s.replace("        if (prefixLength < 2) continue;\n        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);", "        if (prefixLength < 1) continue;\n        const sharedPrefix = (Array.isArray(currentChat) ? currentChat : []).slice(0, prefixLength);")
p.write_text(s)
print('hard-pass review corrections applied')
