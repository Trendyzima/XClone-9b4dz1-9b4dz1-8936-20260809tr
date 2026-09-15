from pathlib import Path
import subprocess, os

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'src/pages/HomePage.tsx'
text = HOME.read_text()
old = "if (!skipCache && activeTab !== 'federated') {"
new = "if (!skipCache && activeTab !== 'federated' && activeTab !== 'foryou') {"
if old in text:
    HOME.write_text(text.replace(old, new, 1))
if os.environ.get('GITHUB_ACTIONS') == 'true':
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=ROOT, check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=ROOT, check=True)
    subprocess.run(['git', 'add', 'src/pages/HomePage.tsx'], cwd=ROOT, check=True)
    subprocess.run(['git', 'commit', '-m', 'fix: keep home federation cursor across pagination'], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT, check=True)
