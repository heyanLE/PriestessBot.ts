#!/usr/bin/env python3
"""Stage the existing NAS v3 config for a dedicated Telegram CODEX test route.

Reads JSON from a file or stdin (`-`) and writes a candidate file. No credentials
are read or written: the existing provider credential reference is preserved.
"""

import argparse
import copy
import json
import pathlib
import sys


def prepare(document: dict, agent_root: pathlib.Path) -> dict:
    document = copy.deepcopy(document)
    if document.get("schemaVersion") != 3:
        raise ValueError("Expected a schema v3 application configuration")

    providers = [item for item in document.get("llms", []) if item.get("id") == "deepseek-v4-flash"]
    if len(providers) != 1:
        raise ValueError("Expected one existing deepseek-v4-flash connection")
    provider = providers[0]
    endpoint = provider.get("endpoint", "").rstrip("/")
    for suffix in ("/chat/completions", "/responses"):
        if endpoint.endswith(suffix):
            endpoint = endpoint[: -len(suffix)]
    if endpoint != "https://api.deepseek.com/v1":
        raise ValueError("NAS CODEX setup requires direct DeepSeek /v1; switch off AxonHub first")
    if not provider.get("credentialRef", {}).get("key"):
        raise ValueError("DeepSeek connection is missing its credential reference")
    provider["endpoint"] = endpoint
    provider["protocol"] = "OPENAI_RESPONSES"

    agents = document.get("agents", [])
    existing = [item for item in agents if item.get("id") == "pipeline-manual-agent"]
    if len(existing) != 1:
        raise ValueError("Expected one existing pipeline-manual-agent")
    existing = existing[0]
    existing["llm"]["model"] = "deepseek-flash"

    codex = copy.deepcopy(existing)
    codex.update(
        id="codex-debug",
        displayName="Codex 调试",
        enabled=True,
        type="CODEX",
        configDirectory=str(agent_root / "config"),
        tempDirectory=str(agent_root / "temp"),
    )
    codex.pop("preset", None)
    codex["llm"]["providerRef"] = provider["id"]
    codex["llm"]["model"] = "deepseek-flash"
    codex["instructions"] = (
        existing.get("instructions", "").rstrip()
        + "\n\nTelegram 私聊以 /codex 开头时，这是路由标记；回答实际问题即可。"
    )
    codex.setdefault("toolPolicy", {}).setdefault("enabled", {})["web_search"] = False
    agents[:] = [item for item in agents if item.get("id") != "codex-debug"] + [codex]

    telegram = [item for item in document.get("ims", []) if item.get("id") == "telegram"]
    if len(telegram) != 1 or telegram[0].get("type") != "telegram":
        raise ValueError("Expected one existing telegram IM connection")
    routes = telegram[0]["routes"]
    private = [item for item in routes if item.get("id") == "private-agent"]
    if len(private) != 1:
        raise ValueError("Expected one existing private-agent route")
    debug_route = copy.deepcopy(private[0])
    debug_route.update(id="codex-debug-private", name="私聊 /codex 调试")
    debug_route["match"].update(textMode="PREFIX", textPattern="/codex ")
    debug_route["action"].update(type="AGENT", agentId="codex-debug", toolInjectionMode="NONE")
    routes[:] = [item for item in routes if item.get("id") != "codex-debug-private"]
    index = next(index for index, item in enumerate(routes) if item.get("id") == "private-agent")
    routes.insert(index, debug_route)
    return document


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Input JSON file, or - for stdin")
    parser.add_argument("candidate", type=pathlib.Path)
    parser.add_argument("--agent-root", type=pathlib.Path, required=True)
    args = parser.parse_args()
    raw = sys.stdin.read() if args.source == "-" else pathlib.Path(args.source).read_text()
    document = prepare(json.loads(raw), args.agent_root)
    args.candidate.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
    print("Prepared CODEX candidate: deepseek-flash, OPENAI_RESPONSES, Telegram /codex route")


if __name__ == "__main__":
    main()
