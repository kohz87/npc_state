from pathlib import Path
import runpy

path = Path(__file__).with_name('patch_v022_fixed.py')
text = path.read_text(encoding='utf-8')
old = "changelog = replace_once(changelog, '# Changelog\\n\\n', '# Changelog\\n\\n' + entry, 'changelog')"
new = "changelog = changelog.replace('# Changelog\\n\\n', '# Changelog\\n\\n' + entry, 1)"
if old not in text:
    raise SystemExit('v0.2.22 runner could not locate changelog insertion guard')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
runpy.run_path(str(path), run_name='__main__')
