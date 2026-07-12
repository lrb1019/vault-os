#!/usr/bin/env python3
"""Build a local Vault OS release archive without touching GitHub or Git state."""

import json
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIRED_ASSETS = ("main.js", "manifest.json", "styles.css")


def read_json(name: str) -> dict:
    with (ROOT / name).open(encoding="utf-8") as file:
        return json.load(file)


def main() -> int:
    manifest = read_json("manifest.json")
    package = read_json("package.json")
    versions = read_json("versions.json")
    version = manifest.get("version")

    if not version or version != package.get("version") or version not in versions:
        print("Version mismatch across package.json, manifest.json, or versions.json.", file=sys.stderr)
        return 1

    missing = [name for name in REQUIRED_ASSETS if not (ROOT / name).is_file()]
    if missing:
        print(f"Missing release assets: {', '.join(missing)}", file=sys.stderr)
        return 1

    archive = ROOT / f"vault-os-v{version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for asset in REQUIRED_ASSETS:
            output.write(ROOT / asset, asset)

    print(f"Created local release archive: {archive.name}")
    print("Publish this verified archive through the authenticated release workflow.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
