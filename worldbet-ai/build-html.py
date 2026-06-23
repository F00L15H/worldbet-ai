import pathlib
base = pathlib.Path(__file__).parent
shell = (base / 'worldbet-ai-shell.html').read_text(encoding='utf-8')
app = (base / 'worldbet-ai-app.js').read_text(encoding='utf-8')
ui = (base / 'worldbet-ai-ui.js').read_text(encoding='utf-8')
full = shell.rstrip() + "\n<script>\n'use strict';\n" + app + '\n' + ui + '\n</script>\n</body>\n</html>\n'
(base / 'worldbet-ai.html').write_text(full, encoding='utf-8')
print('lines:', len(full.splitlines()))
bad = [i+1 for i,l in enumerate(full.splitlines()) if 'Ã' in l or 'â€' in l]
print('bad lines:', len(bad), bad[:5])
