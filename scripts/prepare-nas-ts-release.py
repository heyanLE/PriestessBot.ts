#!/usr/bin/env python3
"""Build a credential-free, deterministic production bundle for native Node NAS.

Only generated application JS, Dashboard assets, dependency manifests and the
required install hook enter the archive. Runtime data and credentials are never
selected. Install dependencies on the target architecture after extraction.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile


ROOT = pathlib.Path(__file__).resolve().parents[1]


def add_file(files: dict[str, bytes], source: pathlib.Path, name: str) -> None:
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"Expected regular release file: {source}")
    resolved = source.resolve()
    if ROOT not in resolved.parents:
        raise ValueError("Release file escapes repository")
    if name in files:
        raise ValueError(f"Duplicate release file: {name}")
    files[name] = source.read_bytes()


def collect_files() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for name in ("package.json", "package-lock.json", "tools/patch-sdk-types.ts"):
        add_file(files, ROOT / name, name)
    skill = "resources/.agent/skill/skill-packager/SKILL.md"
    add_file(files, ROOT / skill, skill)
    # Select outputs by existing source, so removed source files cannot survive
    # a non-clean TypeScript build as stale production modules.
    for tree in ("apps", "packages"):
        for source in sorted((ROOT / tree).rglob("*.ts")):
            if source.name.endswith(".d.ts"):
                continue
            relative = source.relative_to(ROOT).with_suffix(".js")
            add_file(files, ROOT / "dist" / relative, f"dist/{relative.as_posix()}")
    for source in sorted([*(ROOT / "tools").glob("migrate*.ts"), ROOT / "tools/clear-conversation-history.ts"]):
        name = "dist/tools/" + source.with_suffix(".js").name
        add_file(files, ROOT / name, name)
    dashboard = ROOT / "dashboard/dist"
    if not (dashboard / "index.html").is_file():
        raise ValueError("Dashboard build missing index.html")
    allowed = {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf"}
    for source in sorted(dashboard.rglob("*")):
        if source.is_symlink():
            raise ValueError("Dashboard output may not contain symlinks")
        if source.is_file():
            if source.suffix.lower() not in allowed:
                raise ValueError(f"Unreviewed Dashboard asset extension: {source.suffix}")
            add_file(files, source, "dashboard/" + source.relative_to(dashboard).as_posix())
    for name in ("plugin-attribution.md", "native-plugin-capabilities.md", "search-and-prompt-parity.md", "local-reminiscence-parity.md", "native-plugin-migration.md", "shared-group-context.md", "persona-scenes.md", "tool-output-parity.md"):
        add_file(files, ROOT / "docs" / name, "docs/" + name)
    for source in sorted((ROOT / "docs/licenses").glob("*.txt")):
        add_file(files, source, "docs/licenses/" + source.name)
    add_file(files, ROOT / "docs/nas-native-deployment.md", "DEPLOYMENT.md")
    add_file(files, ROOT / "deploy/priestess-ts.service.example", "deploy/priestess-ts.service.example")
    add_file(files, ROOT / "deploy/Dockerfile.execution", "deploy/Dockerfile.execution")
    add_file(files, ROOT / "docs/sdk-docker-execution.md", "docs/sdk-docker-execution.md")
    add_file(files, ROOT / "docs/napcat-long-reply.md", "docs/napcat-long-reply.md")
    add_file(files, ROOT / "docs/napcat-processing-reaction.md", "docs/napcat-processing-reaction.md")
    add_file(files, ROOT / "docs/dashboard-flow-inventory.md", "docs/dashboard-flow-inventory.md")
    add_file(files, ROOT / "docs/dashboard-interaction-design.md", "docs/dashboard-interaction-design.md")
    add_file(files, ROOT / "docs/agents-sdk-tool-permissions.md", "docs/agents-sdk-tool-permissions.md")
    add_file(files, ROOT / "docs/fixed-runtime-states.md", "docs/fixed-runtime-states.md")
    add_file(files, ROOT / "docs/restricted-command-policy.md", "docs/restricted-command-policy.md")
    add_file(files, ROOT / "docs/dashboard-command-permissions.md", "docs/dashboard-command-permissions.md")
    add_file(files, ROOT / "docs/observability.md", "docs/observability.md")
    add_file(files, ROOT / "docs/clear-conversation-history.md", "docs/clear-conversation-history.md")
    add_file(files, ROOT / "docs/inline-reply-and-audit-preview.md", "docs/inline-reply-and-audit-preview.md")
    add_file(files, ROOT / "docs/workspace-zones-and-skills.md", "docs/workspace-zones-and-skills.md")
    add_file(files, ROOT / "docs/tool-description-audit.md", "docs/tool-description-audit.md")
    add_file(files, ROOT / "docs/model-payloads.md", "docs/model-payloads.md")
    manifest = {
        "format": "priestess-native-release-v1",
        "nodeMinimum": "22.18.0",
        "entrypoint": "dist/apps/server/src/main.js",
        "dependencyInstall": "npm ci --omit=dev",
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())},
    }
    files["release-manifest.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    return files


def write_archive(output: pathlib.Path, files: dict[str, bytes]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # No wall-clock timestamps, machine uid/gid, pathnames or gzip filename.
    with output.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    member.mode = 0o644
                    member.mtime = 0
                    archive.addfile(member, io.BytesIO(data))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error("Output already exists; choose a fresh release path")
    # npm installations are deliberately separate, using the checked-in locks.
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    files = collect_files()
    write_archive(output, files)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum = output.with_name(output.name + ".sha256")
    checksum.write_text(f"{digest}  {output.name}\n")
    print(json.dumps({"archive": str(output), "sha256": digest, "fileCount": len(files), "bytes": output.stat().st_size}))


if __name__ == "__main__":
    main()
