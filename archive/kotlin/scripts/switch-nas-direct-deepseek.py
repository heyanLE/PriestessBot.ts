#!/usr/bin/env python3
"""Switch the NAS bot from AxonHub to its DeepSeek channel's upstream API.

Requires the existing NAS Docker containers. Validates the upstream before
switching and restores the previous bot container/config if verification fails.
Does not stop AxonHub; shut it down only after this script succeeds.
"""

import copy
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request


BASE = pathlib.Path("/home/heyanhub/apps/priestessbot")
CONTAINER = "priestessbot"
MODEL = "deepseek-flash"


def output(*command):
    return subprocess.check_output(command, text=True)


def run(*command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def atomic_write(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix=".priestess-direct-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def upstream_channel():
    query = "select row_to_json(t)::text from (select base_url,credentials from channels where id=1 and status='enabled' and (deleted_at=0 or deleted_at is null)) t;"
    raw = output(
        "docker", "exec", "axonhub-postgres", "sh", "-lc",
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc ' + subprocess.list2cmdline([query]),
    ).strip()
    channel = json.loads(raw)
    endpoint = channel["base_url"].rstrip("/")
    keys = channel["credentials"].get("apiKeys", [])
    if endpoint != "https://api.deepseek.com/v1" or len(keys) != 1 or not keys[0].startswith("sk-"):
        raise ValueError("Unexpected DeepSeek upstream channel configuration")
    if "\n" in keys[0] or "\r" in keys[0]:
        raise ValueError("Invalid upstream credential")
    return endpoint, keys[0]


def request_json(url, token, payload=None, timeout=15):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def preflight(endpoint, key):
    response = request_json(endpoint + "/responses", key, {
        "model": MODEL, "input": "Reply OK only.", "max_output_tokens": 16,
    }, timeout=30)
    if not response.get("id"):
        raise RuntimeError("Direct DeepSeek Responses request did not return an id")


def container_args(old, env_file, config, port):
    health_url = f"http://127.0.0.1:{port}/health"
    policy = old["HostConfig"].get("RestartPolicy", {}).get("Name") or "unless-stopped"
    args = ["docker", "run", "-d", "--name", CONTAINER, "--restart", policy,
            "--env-file", str(env_file), "-w", str(BASE / "current")]
    if old["Config"].get("User"):
        args += ["--user", old["Config"]["User"]]
    network = old["HostConfig"].get("NetworkMode") or "bridge"
    args += ["--network", network]
    for mount in old["Mounts"]:
        if mount["Type"] not in ("bind", "volume"):
            raise ValueError("Unsupported Docker mount type")
        source = mount["Source"] if mount["Type"] == "bind" else mount["Name"]
        args += ["-v", source + ":" + mount["Destination"] + (":ro" if not mount.get("RW", True) else "")]
    bindings = old["HostConfig"].get("PortBindings") or {}
    for container_port, ports in bindings.items():
        for binding in ports or []:
            host = binding.get("HostIp") or "0.0.0.0"
            if ":" in host:
                host = "[" + host + "]"
            target = str(port) + "/tcp" if container_port.endswith("/tcp") and len(bindings) == 1 else container_port
            args += ["-p", host + ":" + binding["HostPort"] + ":" + target]
    args += ["--health-cmd", "curl -fsS " + health_url + " >/dev/null || exit 1",
             "--health-interval", "10s", "--health-timeout", "5s",
             "--health-start-period", "30s", "--health-retries", "3",
             old["Config"]["Image"], "./bin/PriestessBot", "--config", str(config)]
    return args, network, health_url


def replace_container():
    if subprocess.run(["docker", "inspect", CONTAINER], capture_output=True).returncode == 0:
        run("docker", "stop", "-t", "30", CONTAINER)
        run("docker", "rm", CONTAINER)


def start_container(old, env_file, config, port):
    args, network, health_url = container_args(old, env_file, config, port)
    run(*args)
    for other in old["NetworkSettings"]["Networks"]:
        if other != network:
            run("docker", "network", "connect", other, CONTAINER)
    return health_url


def wait_healthy(health_url):
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=3) as response:
                health = json.load(response)
            if health.get("status") == "UP" and health.get("diagnostics", {}).get("configMode") == "v3":
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Bot did not become healthy")


def verify(port, dashboard_token):
    root = f"http://127.0.0.1:{port}"
    route = request_json(root + "/api/ims/napcat4_18_6/route-test", dashboard_token,
                         {"sessionType": "GROUP", "text": "只回复OK", "mentionsBot": True,
                          "senderId": "nas-direct-smoke"})
    if route.get("agentId") != "pipeline-manual-agent":
        raise RuntimeError("NapCat route did not select its expected Agent")
    chat = request_json(root + "/api/agent/chat", dashboard_token, {
        "message": "不要调用工具，只回复OK。", "workspaceId": "pipeline-manual-agent",
        "agentId": "pipeline-manual-agent", "sessionId": "nas-direct-smoke-20260925",
    }, timeout=120)
    if chat.get("status") != "FINAL" or chat.get("model") != MODEL:
        raise RuntimeError("Direct DeepSeek Agent test failed")
    return chat.get("content", "")[:80]


def main():
    config = BASE / "config" / "config.json"
    old_bytes = output("docker", "exec", CONTAINER, "cat", str(config)).encode()
    document = json.loads(old_bytes)
    old = json.loads(output("docker", "inspect", CONTAINER))[0]
    old_env = old["Config"]["Env"]
    env_map = dict(item.split("=", 1) for item in old_env)
    port = int(env_map.get("PRIESTESS_SERVER_PORT", document["runtime"]["server"].get("port", 8080)))
    provider = [p for p in document["llms"] if p.get("id") == "deepseek-v4-flash"]
    if len(provider) != 1 or not provider[0].get("endpoint", "").endswith(":8090/v1"):
        raise ValueError("Bot is not using the expected AxonHub endpoint")
    key_ref = provider[0]["credentialRef"]["key"]
    if key_ref != "PRIESTESS_PROVIDER_DEEPSEEK_API_KEY" or key_ref not in env_map:
        raise ValueError("Bot AxonHub credential reference changed")
    endpoint, direct_key = upstream_channel()
    preflight(endpoint, direct_key)
    candidate = copy.deepcopy(document)
    target = next(p for p in candidate["llms"] if p["id"] == provider[0]["id"])
    target["endpoint"] = endpoint
    target["protocol"] = "OPENAI_RESPONSES"
    for agent in candidate["agents"]:
        if agent.get("id") in ("pipeline-manual-agent", "codex-debug"):
            agent["llm"]["model"] = MODEL
    replacement = (json.dumps(candidate, ensure_ascii=False, indent=2) + "\n").encode()
    new_env = [item for item in old_env if not item.startswith(key_ref + "=")]
    new_env.append(key_ref + "=" + direct_key)
    descriptor, filename = tempfile.mkstemp(prefix="priestess-direct-env-", dir="/tmp")
    env_file = pathlib.Path(filename)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("\n".join(new_env) + "\n")
    os.chmod(env_file, 0o600)
    switched = False
    try:
        replace_container()
        switched = True
        atomic_write(config, replacement)
        health_url = start_container(old, env_file, config, port)
        wait_healthy(health_url)
        answer = verify(port, env_map.get("PRIESTESS_SERVER_API_TOKEN", ""))
        print("Direct DeepSeek active: " + endpoint + ", model=" + MODEL + ", NapCat reply=" + answer)
    except Exception:
        if switched:
            print("Direct switch failed; restoring prior bot config and AxonHub credential", file=sys.stderr)
            replace_container()
            atomic_write(config, old_bytes)
            env_file.write_text("\n".join(old_env) + "\n")
            start_container(old, env_file, config, port)
        raise
    finally:
        env_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
