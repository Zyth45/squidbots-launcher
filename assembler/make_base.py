"""make_base.py : paquet de BASE du serveur (sans aucune donnée Blizzard/Ascension), assemblé ensuite chez le joueur.

    python make_base.py --full <repack complet déplié> --core-repo <dépôt du cœur> --core-commit <hash>
                        --jealous <clone de Jealous> --tools <dossier des 4 extracteurs> --out <dossier> --release <id>

1. Copie du repack complet SANS Data/, mysql/data, Database/Clean, Source/sql-tree, .state, journaux.
2. Commit public de Jealous dont l'arbre SQL est identique à celui du cœur (échec sinon : rien de non public).
3. Assembler/ : coa_assemble.py, les extracteurs compilés + DLL VC++, sql-order.json (sql_order.py), assemble.json.
4. Zip 7-Zip + contrôle : aucun fichier de données (dbc, map, vmtree, vmtile, mmtile, mmap, MPQ, base MySQL).
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEVEN = r"C:\Program Files\7-Zip\7z.exe"
SKIP_TOP = {"Data", ".state", "Logs", "Crashes", "Database-Backups"}
SKIP_REL = {"mysql/data", "mysql/logs", "Database/Clean", "Source/sql-tree", "Core/Logs", "BugReport/reports",
            "BugReport/Logs", "CoA-Bots/Core/Logs"}
DATA_EXT = re.compile(r"\.(dbc|map|vmtree|vmtile|vmo|mmtile|mmap|mpq|ibd|frm|myd|myi)$", re.I)
TOOLS = ["map_extractor.exe", "vmap4_extractor.exe", "vmap4_assembler.exe", "mmaps_generator.exe", "mmaps-config.yaml"]
VC = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "concrt140.dll"]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def sql_tree(repo, commit):
    out = git(repo, "ls-tree", "-r", commit, "--", "data/sql", "modules")
    tree = {}
    for line in out.splitlines():
        meta, path = line.split("\t", 1)
        if path.endswith(".sql") and (path.startswith("data/sql/") or "/data/sql/" in path):
            tree[path] = meta.split()[2]
    return tree


def matching_jealous_commit(core_repo, core_commit, jealous):
    """Commit public de Jealous le plus proche de l'arbre SQL du cœur. Les fichiers AJOUTÉS par nous (nos correctifs,
    ex. le pad Horde de Manastorm) sont permis : ils partent dans le paquet (Assembler/overlay) et passent en dernier.
    Un fichier de Jealous modifié ou supprimé chez nous ne l'est pas."""
    ours = sql_tree(core_repo, core_commit)
    git(jealous, "fetch", "-q", "origin", "+refs/heads/main:refs/heads/main")
    best = None
    for line in git(jealous, "log", "--first-parent", "--format=%H", "-300", "HEAD").splitlines():
        theirs = sql_tree(jealous, line)
        bad = sum(1 for p in theirs if ours.get(p) != theirs[p])
        added = sorted(p for p in ours if p not in theirs)
        if best is None or (bad, len(added)) < (best[1], len(best[2])):
            best = (line, bad, added)
        if bad == 0 and not added:
            break
    return best


def copy_tree(src, dst):
    for item in src.rglob("*"):
        rel = item.relative_to(src).as_posix()
        if rel.split("/")[0] in SKIP_TOP or any(rel == s or rel.startswith(s + "/") for s in SKIP_REL):
            continue
        target = dst / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def main():
    a = argparse.ArgumentParser()
    for name in ("full", "core-repo", "core-commit", "jealous", "tools", "out", "release"):
        a.add_argument("--" + name, required=True)
    # Migrations déjà dans le repack de départ des anciennes installs, avec leur heure (voir sql_order.py).
    a.add_argument("--known", required=True)
    a.add_argument("--update", help="dossier CoA-Update-<ver> de la release : en faire aussi la version sans données")
    args = a.parse_args()
    full, out = Path(args.full), Path(args.out)
    commit, bad, overlay = matching_jealous_commit(args.core_repo, args.core_commit, args.jealous)
    if bad:
        raise SystemExit(f"ECHEC : aucun commit public de Jealous n'a l'arbre SQL du cœur ({bad} fichiers de Jealous "
                         f"modifiés ou absents au mieux, {commit[:9]})")
    print(f"SQL à nous (livrés, appliqués en dernier) : {overlay}")
    print(f"SQL publics : Jealous {commit}")
    stage = out / "staging-base" / "CoA-Repack"
    if stage.parent.exists():
        shutil.rmtree(stage.parent)
    stage.mkdir(parents=True)
    copy_tree(full, stage)
    asm = stage / "Assembler"
    (asm / "bin").mkdir(parents=True)
    shutil.copy2(HERE / "Assembler" / "coa_assemble.py", asm)
    for name in TOOLS:
        shutil.copy2(Path(args.tools) / name, asm / "bin")
    for name in VC:
        shutil.copy2(full / "Core" / name, asm / "bin")
    subprocess.run([sys.executable, str(HERE / "sql_order.py"), args.jealous, commit, str(asm / "sql-order.json"), args.known],
                   check=True)
    for rel in overlay:
        target = asm / "overlay" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(subprocess.run(["git", "-C", args.core_repo, "show", f"{args.core_commit}:{rel}"],
                                          capture_output=True, check=True).stdout)
    order = json.loads((asm / "sql-order.json").read_text(encoding="utf-8"))
    sys.path.insert(0, str(HERE))
    from sql_order import classify
    order["overlay"] = [{"path": rel, "db": classify(rel)[0], "state": classify(rel)[1]} for rel in overlay if classify(rel)]
    (asm / "sql-order.json").write_text(json.dumps(order, indent=0), encoding="utf-8")
    skip = json.loads((HERE / "fresh-db-skip.json").read_text(encoding="utf-8"))
    (asm / "assemble.json").write_text(json.dumps({
        "format": 1, "release": args.release,
        "sql": {"repo": "Conquest-of-AzerothCore/azerothcore-wotlk-coa", "commit": commit,
                "url": f"https://codeload.github.com/Conquest-of-AzerothCore/azerothcore-wotlk-coa/tar.gz/{commit}"},
        **skip}, indent=1), encoding="utf-8")
    diag = [p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file() and re.search(
        r"coa[_-]?diag|diag[_-]lag|superviseur|bench", p.name, re.I)]
    diag += [p.relative_to(stage).as_posix() for p in (stage / "CoA-Bots" / "Core").glob("*.exe")
             if b"CoaDiag." in p.read_bytes()]
    if diag:
        raise SystemExit(f"ECHEC : outils de diagnostic dans la base : {diag[:5]}")
    bad = [p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file() and DATA_EXT.search(p.name)]
    if bad:
        raise SystemExit(f"ECHEC : données de jeu dans la base : {bad[:5]}")
    name = f"CoA-Server-Base-{args.release}.zip"
    archive = out / name
    archive.unlink(missing_ok=True)
    subprocess.run([SEVEN, "a", "-tzip", "-mx=5", "-mmt=2", str(archive), "CoA-Repack"], cwd=stage.parent, check=True,
                   capture_output=True)
    import hashlib
    h = hashlib.sha256()
    with archive.open("rb") as f:
        while chunk := f.read(1 << 22):
            h.update(chunk)
    info = {"name": name, "path": str(archive), "sha256": h.hexdigest(), "bytes": archive.stat().st_size, "sqlCommit": commit}
    (out / f"{name}.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print(f"{name} {info['bytes'] >> 20} Mo sha256 {info['sha256']}")
    if args.update:
        make_update(args.update, stage / "Assembler", out, f"CoA-Update-NoData-{args.release}")



def make_update(update_dir, assembler_dir, out, name):
    """Paquet de MISE À JOUR d'un repack existant, sans données : le CoA-Update de la release moins Data/ et moins les
    fichiers de Source/sql-tree (leurs empreintes restent dans le manifeste ; le launcher les reprend dans l'archive
    publique de Jealous avant coa_update.py, voir coa_assemble.py fill-sql), plus Assembler/."""
    import hashlib
    src = Path(update_dir)
    stage = Path(out) / "staging-update" / src.name
    if stage.parent.exists():
        shutil.rmtree(stage.parent)
    shutil.copytree(src, stage, ignore=lambda d, names: [n for n in names if Path(d, n) in
                                                          (src / "payload" / "Data", src / "payload" / "Source" / "sql-tree")])
    shutil.copytree(assembler_dir, stage / "payload" / "Assembler", ignore=shutil.ignore_patterns("cache", "logs"))
    mpath = stage / "update" / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8-sig"))
    files = {rel: e for rel, e in manifest["files"].items() if not rel.startswith("Data/")}
    for p in (stage / "payload" / "Assembler").rglob("*"):
        if p.is_file():
            raw = p.read_bytes()
            files[p.relative_to(stage / "payload").as_posix()] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    manifest["files"] = files
    mpath.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    spec_path = stage / "update" / "update.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    spec["treesKeptFrom"] = {k: v for k, v in spec.get("treesKeptFrom", {}).items() if not k.startswith("Data/")}
    spec["rules"] = [r for r in spec["rules"] if not r["path"].startswith("Data/")]
    # Place demandée avant d'appliquer : sauvegarde de la base et des exe (plus de cartes livrées, 6 Go c'était pour elles).
    spec["diskBytes"] = 4 << 30
    # Le texte de la carte de mise à jour : plus de cartes livrées, quelle que soit la version de départ.
    spec["notice"] = {
        "en": "A small update (about 60 MB): only our files. The core SQL come from the public CoA repository, checked "
              "one by one. Your maps, database, characters, bots and settings are kept; a backup comes first and Undo "
              "puts everything back. New: Dungeon Clear, realm cards like Ascension, Manastorm on by default.",
        "fr": "Petite mise à jour (environ 60 Mo) : seulement nos fichiers. Les SQL du cœur viennent du dépôt public de "
              "CoA, vérifiés un par un. Vos cartes, votre base, vos personnages, vos bots et vos réglages sont gardés ; "
              "une sauvegarde est faite d'abord et le retour arrière remet tout. Nouveau : Dungeon Clear, cartes de "
              "royaume comme sur Ascension, Manastorm actif par défaut.",
        "ru": "Небольшое обновление (около 60 МБ): только наши файлы. SQL ядра берутся из публичного репозитория CoA и "
              "проверяются по одному. Карты, база, персонажи, боты и настройки сохраняются; сначала делается копия, "
              "откат возвращает всё. Новое: Dungeon Clear, карточки миров как на Ascension, Manastorm включён."}
    spec_path.write_text(json.dumps(spec, indent=1, ensure_ascii=False), encoding="utf-8")
    # Marqueur lu par le launcher : remplir Source/sql-tree depuis l'archive publique avant d'appliquer.
    (stage / "update" / "sql-source.json").write_text(json.dumps({"fillSql": "payload/Assembler/coa_assemble.py"}),
                                                     encoding="utf-8")
    bad = [p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file() and DATA_EXT.search(p.name)]
    if bad:
        raise SystemExit(f"ECHEC : données de jeu dans la mise à jour : {bad[:5]}")
    absent = [rel for rel in files if not rel.startswith("Source/sql-tree/") and not (stage / "payload" / rel).is_file()]
    if absent:
        raise SystemExit(f"ECHEC : fichiers du manifeste absents du paquet : {absent[:5]}")
    archive = Path(out) / f"{name}.zip"
    archive.unlink(missing_ok=True)
    subprocess.run([SEVEN, "a", "-tzip", "-mx=5", "-mmt=2", str(archive), stage.name], cwd=stage.parent, check=True,
                   capture_output=True)
    h = hashlib.sha256()
    with archive.open("rb") as f:
        while chunk := f.read(1 << 22):
            h.update(chunk)
    info = {"name": archive.name, "sha256": h.hexdigest(), "bytes": archive.stat().st_size, "folder": stage.name}
    (Path(out) / f"{archive.name}.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print(f"{archive.name} {info['bytes'] >> 20} Mo sha256 {info['sha256']}")
    return info


if __name__ == "__main__":
    main()
