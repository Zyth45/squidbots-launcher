"""release_notes.py : notes de release (en anglais, pour GitHub) d'un paquet sans données.

    python release_notes.py <dossier CoA-Repack du paquet de base> <sortie.md> [--core <hash>] [--dc <hash>]

Lit RELEASE.json (commit du cœur, commits à nous : localCommits), CoA-Bots/release.json (module des bots),
Assembler/assemble.json (commit public de Jealous des SQL) et Assembler/sql-order.json (nos SQL appliqués en dernier).
"""
import argparse
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def main():
    a = argparse.ArgumentParser()
    a.add_argument("root")
    a.add_argument("out")
    a.add_argument("--core", help="commit du cœur s'il diffère de RELEASE.json (correctif posé après le paquet)")
    a.add_argument("--dc", help="commit de mod-dungeon-clear")
    args = a.parse_args()
    root = Path(args.root)
    rel = read(root / "RELEASE.json")
    bots = read(root / "CoA-Bots" / "release.json")
    asm = read(root / "Assembler" / "assemble.json")
    order = read(root / "Assembler" / "sql-order.json")
    core = args.core or rel.get("sourceRevision", "")
    fixes = rel.get("localCommits", [])
    sql = asm["sql"]
    lines = [
        f"# CoA Bots {bots.get('version')} ({rel.get('releaseId')})",
        "",
        "This package contains **no game data**: the launcher extracts the DBC, maps, vmaps and mmaps from your own "
        "Conquest of Azeroth client, and builds the world database from the public SQL of the core.",
        "",
        "## Sources",
        "",
        f"- Core: `Zyth45/azerothcore-wotlk-coa` at `{core}`",
        f"- Bots module: `Zyth45/mod-playerbots` (branch `coa`) at `{str(bots.get('botsModuleRevision', '')).split()[0]}`",
    ]
    if args.dc:
        lines.append(f"- Dungeon Clear: `mod-dungeon-clear` at `{args.dc}`")
    lines += [
        f"- Public SQL and world package: `{sql['repo']}` at `{sql['commit']}`",
        "",
        f"## Core fixes on top of the CoA core ({len(fixes)} commits)",
        "",
    ]
    lines += [f"- `{c.split(' ', 1)[0]}` {c.split(' ', 1)[1] if ' ' in c else ''}" for c in fixes]
    if order.get("overlay"):
        lines += ["", "## Our SQL, applied after all the public ones", ""]
        lines += [f"- `{o['path']}`" for o in order["overlay"]]
    lines += ["", "## Licences", "",
              "The server executables are built from GPL-2.0 sources (AzerothCore and the CoA core); their sources "
              "are public at the commits above. MySQL, OpenSSL and Python keep their own licences (Licenses folder).", ""]
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(f"{args.out} : {len(fixes)} correctifs cœur, {len(order.get('overlay', []))} SQL à nous")


if __name__ == "__main__":
    main()
