"""sql_order.py : ordre d'application des SQL du cœur pour une base NEUVE (côté release, chez nous).

    python sql_order.py <dépôt git du cœur> <commit> <sortie.json>

Le programme de mise à jour du cœur (UpdateFetcher) applique les fichiers par ordre alphabétique de nom. La base
de Jealous, elle, les a reçus dans l'ordre où ils sont arrivés dans le dépôt : sur une base neuve, l'ordre
alphabétique casse (ex. modules/mod-manastorm-endless/.../26_manastorm_cache_molten_core_full_reconstruction.sql
lit des objets créés par des rev_2026… de pending_db_world). On rend donc la liste des fichiers dans l'ordre de leur
première arrivée (renommages suivis), que l'assembleur du joueur applique avant le premier démarrage.
Seuls des chemins et des dates sortent d'ici : aucun contenu SQL.
"""
import json
import re
from pathlib import Path
import subprocess
import sys

DBS = {"db_auth": "auth", "db_characters": "characters", "db_world": "world"}
MODULE_DBS = {"db-auth": "auth", "db-characters": "characters", "db-world": "world"}
# Comme updates_include : dossier -> état.
STATES = {"archive": "ARCHIVED", "custom": "CUSTOM", "updates": "RELEASED"}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", check=True).stdout


def classify(path):
    """(base de données, état) d'un fichier que le cœur appliquerait, sinon None."""
    if not path.endswith(".sql"):
        return None
    parts = path.split("/")
    if parts[:2] == ["data", "sql"] and len(parts) >= 5 and parts[2] in STATES:
        folder = parts[3]
        if folder.startswith("pending_") and parts[2] == "updates":
            db = DBS.get(folder[len("pending_"):])
            return (db, "PENDING") if db else None
        db = DBS.get(folder)
        return (db, STATES[parts[2]]) if db else None
    if parts[0] == "modules" and len(parts) >= 6 and parts[2:4] == ["data", "sql"]:
        for key, db in MODULE_DBS.items():
            if key in parts[4]:
                return db, "MODULE"
    return None


def main():
    repo, commit, out = sys.argv[1:4]
    files = {p: classify(p) for p in git(repo, "ls-tree", "-r", "--name-only", commit, "--", "data/sql", "modules").splitlines()}
    files = {p: c for p, c in files.items() if c}
    # --raw sans détection de renommage (dépôt cloné sans contenus) : un fichier supprimé et un fichier ajouté avec
    # la même empreinte dans le même commit sont un renommage.
    first, seq, t, n = {}, {}, 0, 0
    log = git(repo, "log", "--reverse", "--no-renames", "--raw", "--no-abbrev", "--format=C\t%at", commit, "--",
              "data/sql", "modules")

    def flush(added, deleted):
        for path, blob in added:
            if path in first:
                continue
            old = deleted.get(blob)
            first[path] = first.get(old, t) if old else t
            seq[path] = seq.get(old, n) if old else n

    added, deleted = [], {}
    for line in log.splitlines():
        if line.startswith("C\t"):
            flush(added, deleted)
            added, deleted = [], {}
            t = int(line.split("\t")[1])
            continue
        if not line.startswith(":"):
            continue
        meta, path = line.split("\t", 1)
        _, _, old_blob, new_blob, status = meta.split()
        n += 1
        if status == "A":
            added.append((path, new_blob))
        elif status == "D":
            deleted[old_blob] = path
    flush(added, deleted)
    missing = [p for p in files if p not in first]
    for p in missing:  # arrivé par une fusion : date de son dernier commit
        first[p] = int(git(repo, "log", "-1", "--format=%at", commit, "--", p).strip() or 0)
        seq[p] = 10 ** 9
    phase = {"ARCHIVED": 0, "RELEASED": 0, "PENDING": 1, "CUSTOM": 1, "MODULE": 1}
    # Jealous récupère les commits par paquets et son serveur applique chaque paquet dans son ordre à lui
    # (RELEASED/ARCHIVED, puis PENDING/CUSTOM/MODULE, par nom) : on regroupe par jour d'arrivée (UTC).
    # Les anciennes installs sont parties d'un repack de Jealous (sa base à une date), puis ont reçu le reste d'un
    # bloc, dans l'ordre du serveur. Avec la liste des migrations déjà dans ce repack (4e argument), on refait ce
    # chemin : par jour jusqu'à lui, puis un seul bloc pour la suite (même résultat que ces installs).
    # La liste donne aussi l'heure où la base de Jealous a reçu chaque migration (table updates du repack) :
    # c'est l'ordre exact, que les dates git ne donnent pas toujours.
    known = None
    if len(sys.argv) > 4:
        known = dict(line.split("	", 1) for line in Path(sys.argv[4]).read_text(encoding="utf-8").splitlines() if "	" in line)

    def key(p):
        name = p.rsplit("/", 1)[-1]
        if known is None:
            return (0, str(first[p] // 86400), phase[files[p][1]], name)
        return (0, known[name], phase[files[p][1]], name) if name in known else (1, "", phase[files[p][1]], name)
    order = sorted(files, key=key)
    # Identifiant git de chaque fichier gardé par l'assembleur : il vérifie ce qu'il extrait de l'archive publique.
    keep = re.compile(r"^(data/sql/(base|create|custom|updates|archive)/|modules/[^/]+/data/sql/|data/coa-world/|apps/coa-world/[^/]+\.py$)")
    blobs = {}
    for line in git(repo, "ls-tree", "-r", commit, "--", "data/sql", "modules", "data/coa-world", "apps/coa-world").splitlines():
        meta, path = line.split("	", 1)
        if keep.match(path):
            blobs[path] = meta.split()[2]
    data = {"format": 1, "commit": git(repo, "rev-parse", commit).strip(),
            "files": [{"path": p, "db": files[p][0], "state": files[p][1]} for p in order], "blobs": blobs}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=0)
    print(f"{len(order)} fichiers, {len(missing)} sans date propre")


if __name__ == "__main__":
    main()
