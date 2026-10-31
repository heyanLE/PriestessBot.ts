#!/usr/bin/env python3
"""Install a prepared PriestessBot release and CODEX JNI library on the NAS.

The candidate config is prepared separately. This script verifies every artifact
before touching the live container and restores the previous release on failure.
"""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import time


CONTAINER = "priestessbot"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_atomic(path, content, mode=0o600):
    descriptor, temporary = tempfile.mkstemp(prefix=".priestess-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def docker_args(old, base, config, env_file, server_port):
    args = [
        "docker", "run", "-d", "--name", CONTAINER,
        "--restart", old["HostConfig"].get("RestartPolicy", {}).get("Name") or "unless-stopped",
        "--env-file", str(env_file), "-w", str(base / "current"),
    ]
    if old["Config"].get("User"):
        args += ["--user", old["Config"]["User"]]
    network = old["HostConfig"].get("NetworkMode") or "bridge"
    args += ["--network", network]
    for mount in old["Mounts"]:
        if mount["Type"] not in ("bind", "volume"):
            raise ValueError("Unsupported existing Docker mount type")
        origin = mount["Source"] if mount["Type"] == "bind" else mount["Name"]
        args += ["-v", origin + ":" + mount["Destination"] + (":ro" if not mount.get("RW", True) else "")]
    for container_port, bindings in (old["HostConfig"].get("PortBindings") or {}).items():
        for binding in bindings or []:
            host = binding.get("HostIp") or "0.0.0.0"
            if ":" in host:
                host = "[" + host + "]"
            target = str(server_port) + "/tcp" if container_port.endswith("/tcp") and len(old["HostConfig"].get("PortBindings") or {}) == 1 else container_port
            args += ["-p", host + ":" + binding["HostPort"] + ":" + target]
    health_url = f"http://127.0.0.1:{server_port}/health"
    args += [
        "--health-cmd", "curl -fsS " + health_url + " >/dev/null || exit 1",
        "--health-interval", "10s", "--health-timeout", "5s",
        "--health-start-period", "30s", "--health-retries", "3",
    ]
    args += [old["Config"]["Image"], "./bin/PriestessBot", "--config", str(config)]
    return args, network, health_url


def start_container(old, base, config, env_file, server_port):
    args, network, health_url = docker_args(old, base, config, env_file, server_port)
    run(*args, stdout=subprocess.DEVNULL)
    for other in old["NetworkSettings"]["Networks"]:
        if other != network:
            run("docker", "network", "connect", other, CONTAINER, stdout=subprocess.DEVNULL)
    return health_url


def wait_healthy(health_url, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = subprocess.run(
            ["docker", "exec", CONTAINER, "curl", "-fsS", "--max-time", "3", health_url],
            capture_output=True, text=True,
        )
        if response.returncode == 0:
            try:
                health = json.loads(response.stdout)
            except json.JSONDecodeError:
                health = {}
            if health.get("status") == "UP" and health.get("diagnostics", {}).get("configMode") == "v3":
                return
        time.sleep(1)
    raise RuntimeError("New container did not reach healthy schema v3 state")


def replace_container():
    running = subprocess.run(["docker", "inspect", CONTAINER], capture_output=True)
    if running.returncode == 0:
        subprocess.run(["docker", "stop", "-t", "30", CONTAINER], stdout=subprocess.DEVNULL, check=True)
        run("docker", "rm", CONTAINER, stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=pathlib.Path, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--package", type=pathlib.Path, required=True)
    parser.add_argument("--package-sha256", required=True)
    parser.add_argument("--native", type=pathlib.Path, required=True)
    parser.add_argument("--candidate", type=pathlib.Path, required=True)
    args = parser.parse_args()

    base = args.base.resolve()
    if not args.release.startswith("codex-") or "/" in args.release:
        raise ValueError("Release id must be a codex-* directory name")
    if sha256(args.package) != args.package_sha256:
        raise ValueError("Application package checksum mismatch")
    if not args.native.is_file() or not args.candidate.is_file():
        raise ValueError("Native library and candidate config must exist")
    candidate_bytes = args.candidate.read_bytes()
    candidate = json.loads(candidate_bytes)
    if candidate.get("schemaVersion") != 3:
        raise ValueError("Expected a schema v3 candidate")
    if not any(agent.get("id") == "codex-debug" and agent.get("type") == "CODEX" for agent in candidate.get("agents", [])):
        raise ValueError("Candidate lacks CODEX debug agent")
    config = base / "config" / "config.json"
    old_config_bytes = run("docker", "exec", CONTAINER, "cat", str(config), stdout=subprocess.PIPE).stdout
    old_config = json.loads(old_config_bytes)
    old = json.loads(run("docker", "inspect", CONTAINER, stdout=subprocess.PIPE).stdout)[0]
    old_link = (base / "current").resolve(strict=True)
    current_env = dict(value.split("=", 1) for value in old["Config"]["Env"])
    server = old_config.get("runtime", {}).get("server", {})
    server_port = int(current_env.get("PRIESTESS_SERVER_PORT", server.get("port", 8080)))
    if not 1 <= server_port <= 65535:
        raise ValueError("Invalid HTTP server port")
    if str(current_env.get("PRIESTESS_SERVER_ENABLED", server.get("enabled", False))).lower() not in ("true", "1", "yes", "y"):
        raise ValueError("HTTP server must be enabled for deployment verification")
    release_root = base / "releases" / args.release
    release_root.mkdir(parents=True, exist_ok=False)
    with tarfile.open(args.package) as archive:
        for member in archive.getmembers():
            destination = (release_root / member.name).resolve()
            if destination != release_root and release_root not in destination.parents:
                raise ValueError("Unsafe application archive member")
            if not member.isfile() and not member.isdir():
                raise ValueError("Unexpected link or special file in application archive")
        archive.extractall(release_root)
    native_path = release_root / "lib" / "native" / "libpriestess_codex_jni.so"
    native_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.native, native_path)
    native_path.chmod(0o644)
    native_hash = sha256(native_path)
    if not (release_root / "bin" / "PriestessBot").is_file():
        raise ValueError("Application launch script missing from package")
    env_values = [
        value for value in old["Config"]["Env"]
        if not value.startswith("PRIESTESS_CONFIG_PATH=") and not value.startswith("PRIESTESS_CODEX_")
    ]
    env_values += [
        "PRIESTESS_CONFIG_PATH=" + str(config),
        "PRIESTESS_CODEX_EXPERIMENTAL=true",
        "PRIESTESS_CODEX_JNI_LIB=" + str(base / "current" / "lib" / "native" / native_path.name),
        "PRIESTESS_CODEX_JNI_SHA256=" + native_hash,
    ]
    fd, temporary = tempfile.mkstemp(prefix="priestess-codex-env-", dir="/tmp")
    env_file = pathlib.Path(temporary)
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(env_values) + "\n")
    os.chmod(env_file, 0o600)
    switched = False
    try:
        replace_container()
        switched = True
        link = base / ".current-codex-new"
        link.unlink(missing_ok=True)
        link.symlink_to(release_root)
        os.replace(link, base / "current")
        write_atomic(config, candidate_bytes)
        health_url = start_container(old, base, config, env_file, server_port)
        wait_healthy(health_url)
        print(f"Deployed {args.release}: schema v3, health UP, JNI SHA256 {native_hash}")
    except Exception:
        if switched:
            print("Deployment failed; restoring previous release and configuration", flush=True)
            replace_container()
            link = base / ".current-codex-rollback"
            link.unlink(missing_ok=True)
            link.symlink_to(old_link)
            os.replace(link, base / "current")
            write_atomic(config, old_config_bytes)
            rollback_env = [value for value in old["Config"]["Env"] if not value.startswith("PRIESTESS_CONFIG_PATH=")]
            rollback_env.append("PRIESTESS_CONFIG_PATH=" + str(config))
            env_file.write_text("\n".join(rollback_env) + "\n")
            start_container(old, base, config, env_file, server_port)
        raise
    finally:
        env_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
