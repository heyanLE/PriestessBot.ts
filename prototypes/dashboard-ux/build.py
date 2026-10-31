import base64
from pathlib import Path
import subprocess

project = Path(__file__).resolve().parents[2]
source = Path(__file__).resolve().parent
output = Path('/Users/heyanle/.codex/visualizations/2026/10/25/01a17195-a81f-7b23-860a-29a729947454/priestess-dashboard-prototype.html')
subprocess.run([str(project / 'dashboard/node_modules/.bin/tsc'), '-p', str(source / 'tsconfig.json')], check=True)
subprocess.run([str(project / 'dashboard/node_modules/.bin/esbuild'), str(source / 'app.ts'), '--target=es2022', '--format=iife', '--outfile=' + str(source / 'app.js')], check=True)
logo = base64.b64encode((project / 'dashboard/public/assets/priestess-icon.jpg').read_bytes()).decode()
markup = (source / 'shell.html').read_text().replace('__PRIESTESS_LOGO__', 'data:image/jpeg;base64,' + logo)
css = (source / 'styles.css').read_text()
script = (source / 'app.js').read_text().replace('</script', '<\\/script')
fragment = '<style>\n' + css + '\n</style>\n' + markup + '\n<script>\n' + script + '\n</script>\n'
assert len(fragment.encode()) < 1_000_000
output.write_text(fragment)
subprocess.run(['python3', '/Users/heyanle/.codex/plugins/cache/openai-bundled/visualize/1.0.55/skills/visualize/scripts/render.py', str(output), str(source / 'index.html'), '--force'], check=True)
print('Built standalone HTML and inline prototype:', output)
