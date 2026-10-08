#!/usr/bin/env python3
"""Conservative release check. Reports locations/categories, never matched values."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

patterns = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider-token': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{32,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})'),
    'personal-home-path': re.compile(rb'/(?:home|Users)/[A-Za-z0-9_.-]+/'),
    'private-tailnet-name': re.compile(rb'\b(?![a-zA-Z0-9-]+\.example\.ts\.net\b)[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.ts\.net\b'),
}
private_values = []
env = ROOT / '.env'
if env.exists():
    for line in env.read_text().splitlines():
        if not line or line.lstrip().startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        value = value.strip().strip('\"\'')
        if name == 'OLLAMA_BASE_URL':
            host = urlsplit(value).hostname
            if host and host not in ['localhost', '127.0.0.1', '::1']:
                private_values.append(host.encode())
        elif any(word in name.upper() for word in ['TOKEN', 'SECRET', 'PASSWORD', 'API_KEY']) and len(value) >= 12:
            private_values.append(value.encode())

findings = []
def inspect(label, name, raw):
    parts = Path(name).parts
    sensitive = (Path(name).name.startswith('.env') and Path(name).name != '.env.example') or any(p in parts for p in ['data', 'exports', 'backups', '.aws', '.codex', '.agents']) or name.endswith(('.db', '.db-wal', '.db-shm', '.pem', '.key', '.p12', '.pfx', '.log'))
    if sensitive:
        findings.append({'location': label, 'category': 'sensitive-file'})
    if raw.startswith(b'SQLite format 3'):
        findings.append({'location': label, 'category': 'database-content'})
    for category, pattern in patterns.items():
        if pattern.search(raw):
            findings.append({'location': label, 'category': category})
    if any(value in raw for value in private_values):
        findings.append({'location': label, 'category': 'configured-private-value'})
    if name.endswith('.json'):
        try:
            value = json.loads(raw)
            if isinstance(value, dict) and 'exportedAt' in value and 'profile' in value:
                findings.append({'location': label, 'category': 'health-data-export'})
        except (ValueError, UnicodeError):
            pass

files = sorted(set(git('ls-files', '-co', '--exclude-standard', '-z').decode().split('\0')) - {''})
for name in files:
    path = ROOT / name
    if path.is_file():
        inspect(name, name, path.read_bytes())

# Ignored files can still be force-staged. ls-files includes those above.
objects = git('rev-list', '--objects', '--all').decode().splitlines()
for item in objects:
    oid, _, name = item.partition(' ')
    if name and git('cat-file', '-t', oid).strip() == b'blob':
        inspect('history:' + oid[:10] + ':' + name, name, git('cat-file', 'blob', oid))

# Scan the shipping assets too, without treating ignored build output as a source file.
for directory in ['dist/pages', 'dist/web']:
    for path in (ROOT / directory).rglob('*'):
        if path.is_file():
            inspect(str(path.relative_to(ROOT)), str(path.relative_to(ROOT)), path.read_bytes())

for finding in findings:
    print(json.dumps(finding))
authors = git('log', '--all', '--format=%ae').decode().splitlines()
if any('@' in email and not email.endswith('@users.noreply.github.com') for email in authors):
    print('REVIEW: Git history includes a non-noreply author email. Review commit identity before publishing; address omitted.')
print(f'Checked {len(files)} candidate files, Git history and existing build assets. Findings: {len(findings)}. Values omitted.')
print('This check does not prove absence of PII. Review screenshots, prose, exports, commit identity and staged diff manually.')
sys.exit(1 if findings else 0)
