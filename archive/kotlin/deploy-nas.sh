#!/usr/bin/env bash
set -euo pipefail

# Updates an existing Docker installation. Its v2 source is migrated in place on startup.
# No credentials, backup copies, or legacy generated configuration are bundled.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAS_TARGET="${1:-heyanhub@192.168.31.24}"
NAS_BASE="${2:-/home/heyanhub/apps/priestessbot}"
[[ "$NAS_BASE" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo 'Remote base must be an absolute path without shell metacharacters.' >&2; exit 1; }
RELEASE_ID="v3-$(date -u +%Y%m%dT%H%M%SZ)"
PACKAGE="$PROJECT_DIR/build/deploy/nas/$RELEASE_ID.tar.gz"
cd "$PROJECT_DIR"
./gradlew installDist -PbuildDashboard=true
mkdir -p "$(dirname "$PACKAGE")"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$PACKAGE" -C build/install/PriestessBot .
PACKAGE_SHA="$(shasum -a 256 "$PACKAGE" | awk '{print $1}')"
scp "$PACKAGE" "$NAS_TARGET:/tmp/priestessbot-$RELEASE_ID.tar.gz"
ssh "$NAS_TARGET" python3 - "$NAS_BASE" "$RELEASE_ID" "$PACKAGE_SHA" <<'PY'
import hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request
base, release, expected = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
package = pathlib.Path('/tmp') / ('priestessbot-' + release + '.tar.gz')
assert hashlib.sha256(package.read_bytes()).hexdigest() == expected, 'Release checksum mismatch'
old = json.loads(subprocess.check_output(['docker', 'inspect', 'priestessbot']))[0]
root = base / 'releases' / release
root.mkdir(parents=True, exist_ok=False)
with tarfile.open(package) as archive:
    for member in archive.getmembers():
        destination = (root / member.name).resolve()
        assert destination == root or root in destination.parents, 'Unsafe archive member'
        assert not member.issym() and not member.islnk(), 'Links are not expected in application releases'
    archive.extractall(root)
config = base / 'config' / 'config.json'
assert config.is_file(), 'Existing configuration is required'
current_document = json.loads(subprocess.check_output(['docker', 'exec', 'priestessbot', 'cat', str(config)]))
current_env = dict(value.split('=', 1) for value in old['Config']['Env'])
server = current_document.get('runtime', {}).get('server', {})
server_port = int(current_env.get('PRIESTESS_SERVER_PORT', server.get('port', 8080)))
assert 1 <= server_port <= 65535, 'Invalid configured HTTP port'
server_enabled = str(current_env.get('PRIESTESS_SERVER_ENABLED', server.get('enabled', False))).lower() in ('true', '1', 'yes', 'y')
health_url = 'http://127.0.0.1:' + str(server_port) + '/health'
env_file = None
try:
    fd, filename = tempfile.mkstemp(prefix='priestess-v3-env-', dir='/tmp')
    env_file = pathlib.Path(filename)
    with os.fdopen(fd, 'w') as stream:
        stream.write('\n'.join(value for value in old['Config']['Env'] if not value.startswith('PRIESTESS_CONFIG_PATH=')))
        stream.write('\nPRIESTESS_CONFIG_PATH=' + str(config) + '\n')
    subprocess.run(['docker', 'stop', '-t', '30', 'priestessbot'], check=True)
    subprocess.run(['docker', 'rm', 'priestessbot'], check=True)
    link = base / 'current.v3-new'
    if link.is_symlink(): link.unlink()
    link.symlink_to(root)
    os.replace(link, base / 'current')
    args = ['docker', 'run', '-d', '--name', 'priestessbot', '--restart', 'unless-stopped', '--env-file', str(env_file), '-w', str(base / 'current')]
    if old['Config']['User']: args += ['--user', old['Config']['User']]
    network = old['HostConfig'].get('NetworkMode') or 'bridge'
    args += ['--network', network]
    for mount in old['Mounts']:
        assert mount['Type'] in ('bind', 'volume'), 'Unsupported existing Docker mount type'
        origin = mount['Source'] if mount['Type'] == 'bind' else mount['Name']
        args += ['-v', origin + ':' + mount['Destination'] + (':ro' if not mount.get('RW', True) else '')]
    for container_port, bindings in (old['HostConfig'].get('PortBindings') or {}).items():
        for binding in bindings or []:
            host = binding.get('HostIp') or '0.0.0.0'
            if ':' in host: host = '[' + host + ']'
            target_port = str(server_port) + '/tcp' if container_port.endswith('/tcp') and len(old['HostConfig'].get('PortBindings') or {}) == 1 else container_port
            args += ['-p', host + ':' + binding['HostPort'] + ':' + target_port]
    if server_enabled:
        args += ['--health-cmd', 'curl -fsS ' + health_url + ' >/dev/null || exit 1', '--health-interval', '10s', '--health-timeout', '5s', '--health-start-period', '30s', '--health-retries', '3']
    args += [old['Config']['Image'], './bin/PriestessBot', '--config', str(config)]
    subprocess.run(args, check=True)
    for other in old['NetworkSettings']['Networks']:
        if other != network:
            subprocess.run(['docker', 'network', 'connect', other, 'priestessbot'], check=True)
    for attempt in range(50):
        if not server_enabled:
            logs = subprocess.check_output(['docker', 'logs', 'priestessbot'], stderr=subprocess.STDOUT, text=True)
            if 'PriestessBot is running.' in logs:
                print('Deployed ' + release + ': runtime started (HTTP server disabled)')
                break
            time.sleep(1)
            continue
        result = subprocess.run(['docker', 'exec', 'priestessbot', 'curl', '-fsS', '--max-time', '3', health_url], capture_output=True, text=True)
        if result.returncode == 0:
            health = json.loads(result.stdout)
            if health.get('status') == 'UP' and health.get('diagnostics', {}).get('configMode') == 'v3':
                print('Deployed ' + release + ': schema v3, health UP')
                break
        time.sleep(1)
    else:
        print('New runtime did not become healthy. Inspect: docker logs priestessbot', file=sys.stderr)
        sys.exit(1)
finally:
    if env_file is not None: env_file.unlink(missing_ok=True)
PY
