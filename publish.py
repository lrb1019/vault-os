#!/usr/bin/env python3
"""Build and verify the mandatory BRAT release payload."""

import json
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIRED_PLUGIN_ASSETS = ("main.js", "manifest.json", "styles.css")


def read_json(name: str) -> dict:
    with (ROOT / name).open(encoding="utf-8") as file:
        return json.load(file)


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def verify_archive(archive: Path) -> bool:
    with zipfile.ZipFile(archive) as payload:
        names = tuple(payload.namelist())
        if names != REQUIRED_PLUGIN_ASSETS:
            print(
                "Release ZIP must contain only main.js, manifest.json, and styles.css at its root.",
                file=sys.stderr,
            )
            return False
        return all(payload.getinfo(name).file_size > 0 for name in REQUIRED_PLUGIN_ASSETS)


def main() -> int:
    manifest = read_json("manifest.json")
    package = read_json("package.json")
    versions = read_json("versions.json")
    version = manifest.get("version")

    if not version or version != package.get("version") or version not in versions:
        return fail("Version mismatch across package.json, manifest.json, or versions.json.")

    missing = [name for name in REQUIRED_PLUGIN_ASSETS if not (ROOT / name).is_file()]
    if missing:
        return fail(f"Missing mandatory BRAT release assets: {', '.join(missing)}")

    empty = [name for name in REQUIRED_PLUGIN_ASSETS if (ROOT / name).stat().st_size == 0]
    if empty:
        return fail(f"Empty mandatory BRAT release assets: {', '.join(empty)}")

    archive = ROOT / f"vault-os-v{version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for asset in REQUIRED_PLUGIN_ASSETS:
            output.write(ROOT / asset, asset)

    if not verify_archive(archive):
        return 1

    payload = (*REQUIRED_PLUGIN_ASSETS, archive.name)
    print(f"Verified BRAT release payload: {', '.join(payload)}")
    print("Publish only these four verified assets through the release workflow.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
