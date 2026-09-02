from pathlib import Path
import runpy

path = Path(__file__).with_name('post_v022_pass4_fixed.py')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "prefix, section = runtime.split(section_marker, 1)\n",
    "prefix, tail = runtime.split(section_marker, 1)\nend_marker = '    // Non-truncation structural JSON errors also get one clean correction retry. Local separator\\n'\nif tail.count(end_marker) != 1:\n    raise SystemExit(f'runtime v0.2.22 end marker: expected one match, found {tail.count(end_marker)}')\nsection, suffix = tail.split(end_marker, 1)\n",
    1,
)
text = text.replace(
    "runtime = prefix + section_marker + section\n",
    "runtime = prefix + section_marker + section + end_marker + suffix\n",
    1,
)
path.write_text(text, encoding='utf-8')
runpy.run_path(str(path), run_name='__main__')
