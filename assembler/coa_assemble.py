"""coa_assemble.py : assemble le serveur CoA Bots chez le joueur, sans aucune donnée livrée par nous.

    python -B Assembler/coa_assemble.py status
    python -B Assembler/coa_assemble.py run --client "C:/Jeux/CoA" [--steps client,dbc,maps,vmaps,sql,db]
    python -B Assembler/coa_assemble.py mmaps [--threads N]
    python -B Assembler/coa_assemble.py client-changed --client "C:/Jeux/CoA"

Données de jeu : extraites du client du joueur par les extracteurs du cœur (map_extractor -r lit les archives
.ORIGINAL comme apps/coa-dbc/client_dbc.py --original ; vmap4_extractor/assembler ; mmaps_generator en fond,
carte par carte, reprenable). Base : SQL publics du dépôt de Jealous au commit de la release (Assembler/assemble.json),
appliqués dans l'ordre où ils sont arrivés dans le dépôt (Assembler/sql-order.json), pas par ordre alphabétique.
Chaque ligne de sortie avec --json est un objet JSON : {"event": "step"|"progress"|"log"|"done"|"error", ...}.
État : .state/assemble.json.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BIN = HERE / "bin"
STATE_FILE = ROOT / ".state" / "assemble.json"
DATA = ROOT / "Data"
HIDDEN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
BELOW_NORMAL = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
LOCALES = ("enUS", "enGB", "deDE", "frFR", "esES", "esMX", "ruRU", "koKR", "zhCN", "zhTW")
STEPS = ("client", "dbc", "maps", "vmaps", "sql", "db")
JSON_OUT = False
# Maps the CoA core requires in Map.dbc (the realm refuses other DBC sets).
COA_MAP = 3690


class Fail(Exception):
    pass


def emit(event, **fields):
    if JSON_OUT:
        print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)
    elif event == "progress":
        print(f"  {fields.get('step')}: {fields.get('done')}/{fields.get('total')} {fields.get('text', '')}", flush=True)
    else:
        print(f"[{event}] " + " ".join(f"{k}={v}" for k, v in fields.items()), flush=True)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def load_state():
    return read_json(STATE_FILE, {}) or {}


def save_state(state):
    write_json(STATE_FILE, state)


def manifest():
    data = read_json(HERE / "assemble.json")
    if not data:
        raise Fail("Assembler/assemble.json is missing: this package cannot be assembled.")
    return data


def manage():
    """Le manage.py du repack (ports, mots de passe, my.ini, suivi des processus)."""
    spec = importlib.util.spec_from_file_location("coa_manage", ROOT / "Scripts" / "manage.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def server_running(m=None):
    m = m or manage()
    return any(m.process(name) for name in ("world", "auth", "supervisor"))


def run_tool(args, cwd, log_name, on_line=None, priority=0):
    log = ROOT / "Assembler" / "logs" / log_name
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("w", encoding="utf-8", errors="replace") as out:
        child = subprocess.Popen([str(a) for a in args], cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL, creationflags=HIDDEN | priority)
        for raw in child.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            out.write(line + "\n")
            if on_line and line:
                on_line(line)
        code = child.wait()
    if code:
        raise Fail(f"{Path(args[0]).name} stopped with code {code} (see Assembler/logs/{log_name}).")


# ------------------------------------------------------------------------------------------------- client
def client_archives(client):
    data = Path(client) / "Data"
    found = []
    for folder in [data] + [data / loc for loc in LOCALES if (data / loc).is_dir()]:
        for item in folder.iterdir():
            if item.is_file() and re.search(r"\.mpq(\.original)?$", item.name, re.I):
                found.append(item)
    return found


def client_fingerprint(client):
    """Empreinte des archives du client (nom, taille, date) : un patch du client la change."""
    h = hashlib.sha256()
    data = Path(client) / "Data"
    for item in sorted(client_archives(client), key=lambda p: str(p).lower()):
        st = item.stat()
        h.update(f"{item.relative_to(data).as_posix().lower()}|{st.st_size}|{int(st.st_mtime)}\n".encode())
    return h.hexdigest()


def check_client(client):
    client = Path(client)
    data = client / "Data"
    if not data.is_dir():
        raise Fail(f"{client} is not a game folder (no Data folder).")
    locale = next((loc for loc in LOCALES if (data / loc / f"locale-{loc}.MPQ").is_file()), None)
    if not locale:
        raise Fail("No game language found in the client (Data/<language>/locale-xxXX.MPQ).")
    for name in ("common.MPQ", "common-2.MPQ", "expansion.MPQ", "lichking.MPQ"):
        if not (data / name).is_file():
            raise Fail(f"The client is incomplete: Data/{name} is missing.")
    if not any(re.fullmatch(r"patch-[A-Za-z]+\.MPQ", p.name, re.I) for p in data.iterdir()):
        raise Fail("This is not a Conquest of Azeroth client (no lettered patch-X.MPQ archive).")
    return locale


def dbc_ids(path):
    raw = path.read_bytes()
    if raw[:4] != b"WDBC":
        return set()
    records, fields, size = (int.from_bytes(raw[4 + 4 * i:8 + 4 * i], "little") for i in range(3))
    return {int.from_bytes(raw[20 + r * size:24 + r * size], "little") for r in range(records)}


# ------------------------------------------------------------------------------------------------- extraction
def fresh_dir(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    return path


def swap_in(new, target):
    """Remplace target par new ; l'ancien dossier part en .old puis est effacé."""
    old = target.with_name(target.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if target.exists():
        target.rename(old)
    new.rename(target)
    if old.exists():
        shutil.rmtree(old, ignore_errors=True)


def step_dbc(client, state):
    work = fresh_dir(DATA / ".work-dbc")
    emit("step", step="dbc", text="Reading the game tables (DBC) from your client")
    count = [0]

    def line(text):
        if text.startswith("Extracted") or "dbc" in text.lower():
            count[0] += 1
    run_tool([BIN / "map_extractor.exe", "-e", "2", "-r", "-i", client, "-o", work], work, "dbc.log", line)
    dbc = work / "dbc"
    names = list(dbc.glob("*.dbc"))
    if len(names) < 300:
        raise Fail(f"Only {len(names)} game tables were extracted: the client looks incomplete.")
    if COA_MAP not in dbc_ids(dbc / "Map.dbc"):
        raise Fail("These game tables are not Conquest of Azeroth ones (map 3690 missing): use the CoA client.")
    (dbc / "component.wow-enUS.txt").unlink(missing_ok=True)
    swap_in(dbc, DATA / "dbc")
    shutil.rmtree(work, ignore_errors=True)
    emit("progress", step="dbc", done=len(names), total=len(names), text=f"{len(names)} tables")


def step_maps(client, state):
    work = fresh_dir(DATA / ".work-maps")
    emit("step", step="maps", text="Extracting the terrain and cameras from your client")
    total = [0]

    def line(text):
        m = re.match(r"Extract .*?\((\d+)/(\d+)\)", text)
        if m:
            emit("progress", step="maps", done=int(m.group(1)), total=int(m.group(2)), text=text[:80])
    run_tool([BIN / "map_extractor.exe", "-e", "5", "-i", client, "-o", work], work, "maps.log", line)
    if len(list((work / "maps").glob("*.map"))) < 5000:
        raise Fail("The terrain extraction is incomplete (see Assembler/logs/maps.log).")
    swap_in(work / "maps", DATA / "maps")
    if (work / "Cameras").is_dir():
        swap_in(work / "Cameras", DATA / "Cameras")
    shutil.rmtree(work, ignore_errors=True)


def step_vmaps(client, state):
    work = fresh_dir(DATA / ".work-vmaps")
    emit("step", step="vmaps", text="Extracting buildings and objects (vmaps)")
    seen = [0]

    def line(text):
        seen[0] += 1
        if seen[0] % 500 == 0:
            emit("progress", step="vmaps", done=seen[0], total=0, text="extracting")
    # Comme vmap4_assembler, l'extracteur plante parfois sur le LAPTOP (corruption du tas, carte 1730) et passe ensuite :
    # jusqu'à trois essais, chacun dans un dossier de travail propre.
    for attempt in range(3):
        try:
            run_tool([BIN / "vmap4_extractor.exe", "-l", "-d", str(Path(client) / "Data")], work, "vmaps-extract.log", line)
            break
        except Fail as error:
            if attempt == 2:
                raise
            emit("log", step="vmaps", text=f"{error} Trying again.")
            work = fresh_dir(DATA / ".work-vmaps")
    emit("step", step="vmaps", text="Assembling vmaps")
    # vmap4_assembler plante parfois (violation d'accès, vu une fois sur le LAPTOP) puis passe sur les mêmes fichiers :
    # jusqu'à trois essais avant d'abandonner.
    for attempt in range(3):
        if (work / "vmaps").exists():
            shutil.rmtree(work / "vmaps")
        (work / "vmaps").mkdir()
        try:
            run_tool([BIN / "vmap4_assembler.exe", "Buildings", "vmaps"], work, "vmaps-assemble.log")
            break
        except Fail as error:
            if attempt == 2:
                raise
            emit("log", step="vmaps", text=f"{error} Trying again.")
    if len(list((work / "vmaps").iterdir())) < 1000:
        raise Fail("The vmaps are incomplete (see Assembler/logs/vmaps-*.log).")
    swap_in(work / "vmaps", DATA / "vmaps")
    shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------------------------------------- mmaps
def map_ids():
    ids = set()
    for p in (DATA / "maps").glob("*.map"):
        if p.stem.isdigit() and len(p.stem) >= 7:
            ids.add(int(p.stem[:-4]))
    for p in (DATA / "vmaps").glob("*.vmtree"):
        if p.stem.isdigit():
            ids.add(int(p.stem))
    return ids


def map_hash(mid):
    """Empreinte des fichiers dont dépendent les mmaps d'une carte (pour ne refaire que les cartes changées)."""
    h = hashlib.sha256()
    prefix = f"{mid:03d}"
    files = [p for p in (DATA / "maps").glob(prefix + "*.map") if p.stem[:-4] == prefix]
    files += [p for p in (DATA / "vmaps").glob(prefix + "*") if p.name.split("_")[0].split(".")[0] == prefix]
    for p in sorted(files):
        st = p.stat()
        h.update(f"{p.name}|{st.st_size}\n".encode())
    return h.hexdigest(), len(files)


def pid_alive(pid):
    """Ce processus tourne-t-il encore ? (tasklist, sans dépendance)"""
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True,
                         creationflags=HIDDEN).stdout
    return str(pid) in out


def junction(link, target):
    if link.exists():
        return
    subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, check=True,
                   creationflags=HIDDEN)


def step_mmaps(threads):
    """Cartes de navigation des bots : une carte à la fois dans Data/.work-mmaps, puis déplacée dans Data/mmaps.
    Reprend là où elle s'est arrêtée ; ne refait que les cartes dont maps/vmaps ont changé."""
    if not (DATA / "maps").is_dir() or not (DATA / "vmaps").is_dir():
        raise Fail("Extract the maps and vmaps first.")
    # Une seule construction à la fois (plusieurs clics sur « Build them now » en lançaient plusieurs).
    lock = ROOT / ".state" / "mmaps.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        other = int(lock.read_text(encoding="utf-8") or 0)
    except (OSError, ValueError):
        other = 0
    if other and other != os.getpid() and pid_alive(other):
        emit("log", step="mmaps", text=f"The navigation maps are already being built (process {other}).")
        return
    lock.write_text(str(os.getpid()), encoding="utf-8")
    state = load_state()
    done = state.setdefault("mmaps", {}).setdefault("maps", {})
    sizes = {mid: map_hash(mid) for mid in map_ids()}
    todo = [mid for mid, (h, n) in sizes.items() if n and done.get(str(mid)) != h]
    # Les petites cartes d'abord (donjons, raids, champs de bataille : quelques secondes chacune), pour que les bots
    # se déplacent bien en instance au bout de quelques minutes ; les quatre continents ensuite, les plus longs.
    last = [0, 1, 530, 571]
    todo.sort(key=lambda mid: (1, last.index(mid)) if mid in last else (0, sizes[mid][1], mid))
    total = len([mid for mid, (h, n) in sizes.items() if n])
    work = DATA / ".work-mmaps"
    work.mkdir(exist_ok=True)
    junction(work / "maps", DATA / "maps")
    junction(work / "vmaps", DATA / "vmaps")
    out = work / "mmaps"
    final = DATA / "mmaps"
    final.mkdir(exist_ok=True)
    config = work / "mmaps-config.yaml"
    config.write_text((BIN / "mmaps-config.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    tiles_total = sum(n for h, n in sizes.values() if n)
    tiles_done = sum(sizes[int(m)][1] for m in done if m.isdigit() and int(m) in sizes)
    state["mmaps"].pop("paused", None)
    state["mmaps"].update({"total": total, "running": True, "pid": os.getpid(), "tilesTotal": tiles_total,
                           "tilesDone": tiles_done})
    save_state(state)
    try:
        for i, mid in enumerate(todo):
            emit("progress", step="mmaps", done=total - len(todo) + i, total=total, map=mid,
                 text=f"map {mid}")
            state = load_state()
            state.setdefault("mmaps", {}).update({"current": mid, "running": True, "pid": os.getpid()})
            save_state(state)
            fresh_dir(out)
            run_tool([BIN / "mmaps_generator.exe", str(mid), "--config", config, "--threads", str(threads), "--silent"],
                     work, "mmaps-last.log", priority=BELOW_NORMAL)
            for p in final.glob(f"{mid:03d}*"):
                if p.name == f"{mid:03d}.mmap" or (p.suffix == ".mmtile" and p.stem[:-4] == f"{mid:03d}"):
                    p.unlink()
            for p in out.iterdir():
                os.replace(p, final / p.name)
            state = load_state()
            state.setdefault("mmaps", {}).setdefault("maps", {})[str(mid)] = sizes[mid][0]
            state["mmaps"]["tilesDone"] = state["mmaps"].get("tilesDone", 0) + sizes[mid][1]
            save_state(state)
        emit("progress", step="mmaps", done=total, total=total, text="all maps")
    finally:
        state = load_state()
        state.setdefault("mmaps", {})["running"] = False
        save_state(state)
        lock.unlink(missing_ok=True)
    shutil.rmtree(out, ignore_errors=True)


# ------------------------------------------------------------------------------------------------- SQL
def download(url, dest, sha256=None):
    """Téléchargement reprenable (Range)."""
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={"User-Agent": "SquidBots-Assembler", **({"Range": f"bytes={have}-"} if have else {})})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if have and resp.status != 206:
            have = 0
        total = int(resp.headers.get("Content-Length") or 0) + have
        with part.open("ab" if have else "wb") as out:
            done = have
            last = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if time.time() - last > 1:
                    emit("progress", step="sql", done=done, total=total, text="downloading the public SQL")
                    last = time.time()
    if sha256:
        h = hashlib.sha256()
        with part.open("rb") as f:
            while chunk := f.read(1 << 22):
                h.update(chunk)
        if h.hexdigest() != sha256:
            part.unlink()
            raise Fail("The downloaded SQL archive is not the expected one; try again.")
    os.replace(part, dest)


SQL_KEEP = re.compile(r"^(data/sql/(base|create|custom|updates|archive)/|modules/[^/]+/data/sql/|data/coa-world/|apps/coa-world/[^/]+\.py$)")


def extract_sql(tree, only=None):
    """Les SQL publics du cœur au commit de la release, vérifiés un par un, plus nos SQL (overlay), dans `tree`.
    `only` : les chemins voulus (relatifs à l'arbre), sinon tout ce que garde SQL_KEEP. Rend le nombre de fichiers."""
    info = manifest()["sql"]
    emit("step", step="sql", text=f"Downloading the public SQL of the core ({info['commit'][:9]})")
    cache = HERE / "cache"
    cache.mkdir(exist_ok=True)
    archive = cache / f"sql-{info['commit'][:12]}.tar.gz"
    if not archive.exists():
        download(info["url"], archive)
    if tree.exists():
        shutil.rmtree(tree)
    tree.mkdir(parents=True)
    overlay = HERE / "overlay"
    ours = {item.relative_to(overlay).as_posix() for item in overlay.rglob("*") if item.is_file()} if overlay.is_dir() else set()
    n = 0
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            parts = member.name.split("/", 1)
            if len(parts) < 2 or not member.isfile():
                continue
            rel = parts[1]
            if ".." in rel.split("/") or not (rel in only if only is not None else SQL_KEEP.match(rel)):
                continue
            target = tree / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if rel.startswith("data/sql/archive/"):
                # Comme le repack de Jealous : déjà dans la base de départ, jamais relus (Updates.ArchivedRedundancy = 0),
                # livrés vides ; leurs empreintes sont alors celles des paquets de mise à jour.
                target.write_bytes(b"")
            else:
                with tar.extractfile(member) as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            n += 1
            if n % 500 == 0:
                emit("progress", step="sql", done=n, total=0, text="unpacking")
    # Chaque fichier doit être celui du commit (identifiant git = sha1 de « blob <taille>\0<contenu> »).
    blobs = read_json(HERE / "sql-order.json")["blobs"]
    for rel, blob in blobs.items():
        if (only is not None and rel not in only) or rel.startswith("data/sql/archive/"):
            continue
        path = tree / rel
        if not path.is_file():
            raise Fail(f"The SQL archive lacks {rel}: wrong archive.")
        raw = path.read_bytes()
        if hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest() != blob:
            raise Fail(f"{rel} is not the expected file: wrong archive.")
    # Nos propres SQL (correctifs du cœur pas encore chez Jealous), livrés dans le paquet : dans l'arbre comme les autres.
    for rel in ours:
        if only is None or rel in only:
            target = tree / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(overlay / rel, target)
            n += 1
    if only is not None and n != len(only):
        missing = sorted(only - {p.relative_to(tree).as_posix() for p in tree.rglob("*") if p.is_file()})
        raise Fail(f"{len(missing)} SQL file(s) of this update are not in the public archive: {missing[:3]}")
    archive.unlink(missing_ok=True)
    return n


def step_sql(state):
    """Source/sql-tree (MAJ appliquées par le serveur), avec la base et le paquet monde (effacés après la base)."""
    tree = ROOT / "Source" / "sql-tree.new"
    n = extract_sql(tree)
    swap_in(tree, ROOT / "Source" / "sql-tree")
    state["sql"] = {"commit": manifest()["sql"]["commit"], "files": n}


def cmd_fill_sql(args):
    """Paquet de mise à jour d'un repack existant : son arbre SQL est rempli ici depuis l'archive publique, exactement
    les fichiers de son manifeste (coa_update.py les vérifie ensuite par sha256 avant d'appliquer)."""
    payload = Path(args.into)
    listed = read_json(args.manifest)["files"]
    only = {rel[len("Source/sql-tree/"):] for rel in listed if rel.startswith("Source/sql-tree/")}
    n = extract_sql(payload / "Source" / "sql-tree", only)
    emit("done", steps=["fill-sql"], files=n)


# ------------------------------------------------------------------------------------------------- database
def mysql_cmd(m, *, root_password=None, database=None, charset="utf8"):
    cfg = m.settings()
    args = [str(ROOT / "mysql/bin/mysql.exe"), "--no-defaults", "-uroot", "--host=127.0.0.1", f"--port={cfg['mysqlPort']}",
            f"--default-character-set={charset}", "--max-allowed-packet=1GB"]
    if root_password:
        args.append(f"--password={root_password}")
    else:
        args.append("--skip-password")
    if database:
        args.append(database)
    return args


def sql(m, text_or_bytes, *, password, database=None):
    data = text_or_bytes.encode("utf-8") if isinstance(text_or_bytes, str) else text_or_bytes
    p = subprocess.run(mysql_cmd(m, root_password=password, database=database), input=data, capture_output=True,
                       creationflags=HIDDEN)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace").strip()


def srp6(username, password):
    """Sel et vérificateur SRP6 du cœur (comme AccountMgr::CreateAccount)."""
    n = int("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)
    salt = secrets.token_bytes(32)
    h1 = hashlib.sha1(f"{username.upper()}:{password.upper()}".encode()).digest()
    x = int.from_bytes(hashlib.sha1(salt + h1).digest(), "little")
    return salt, pow(7, x, n).to_bytes(32, "little")


def step_db(state):
    m = manage()
    marker = ROOT / ".state" / "assemble-db-started"
    if server_running(m):
        raise Fail("Stop the server before building its database.")
    # Une construction coupée (launcher fermé, PC éteint) : sa base à moitié faite est arrêtée et refaite.
    if marker.exists() and "db" not in state.get("steps", {}):
        emit("log", step="db", text="An interrupted database build is started again from the beginning.")
        if m.process("mysql"):
            subprocess.run([str(ROOT / "mysql/bin/mysqladmin.exe"), "--no-defaults", "-uroot", "--host=127.0.0.1",
                            f"--port={m.settings()['mysqlPort']}", f"--password={read_json(ROOT / 'Settings/database.json')['rootPassword']}",
                            "shutdown"], capture_output=True, creationflags=HIDDEN)
            for _ in range(60):
                if not m.process("mysql"):
                    break
                time.sleep(1)
        shutil.rmtree(ROOT / "mysql/data", ignore_errors=True)
    if m.process("mysql"):
        raise Fail("Stop the server before building its database.")
    if (ROOT / "mysql/data/mysql").is_dir():
        raise Fail("A database already exists in mysql/data: it is kept (nothing was changed).")
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(str(int(time.time())), encoding="utf-8")
    info = manifest()
    tree = ROOT / "Source" / "sql-tree"
    if not (tree / "data/sql/base").is_dir():
        raise Fail("Download the public SQL first.")
    creds_path = ROOT / "Settings" / "database.json"
    creds = {"rootPassword": secrets.token_hex(24), "appPassword": secrets.token_hex(24)}
    write_json(creds_path, creds)
    cfg = m.settings()
    m.prepare(cfg)
    emit("step", step="db", text="Creating the database")
    data_dir = ROOT / "mysql" / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)
    (ROOT / "mysql" / "logs").mkdir(parents=True, exist_ok=True)
    run_tool([ROOT / "mysql/bin/mysqld.exe", "--defaults-file=" + str(ROOT / "mysql/my.ini"), "--initialize-insecure"],
             ROOT / "mysql", "mysql-init.log")
    m.ensure_free(cfg["mysqlPort"])
    m.spawn("mysql", [ROOT / "mysql/bin/mysqld.exe", "--defaults-file=" + str(ROOT / "mysql/my.ini"), "--no-monitor"],
            ROOT / "mysql", ROOT / "mysql/logs/startup.log")
    m.wait_ready("mysql", cfg["mysqlPort"], 120)
    root, app = creds["rootPassword"], creds["appPassword"]
    users = "".join(f"CREATE USER IF NOT EXISTS 'acore'@'{h}' IDENTIFIED BY '{app}';" for h in ("localhost", "127.0.0.1"))
    grants = "".join(f"GRANT ALL PRIVILEGES ON `{db}`.* TO 'acore'@'{h}' WITH GRANT OPTION;"
                     for db in ("acore_world", "acore_characters", "acore_auth") for h in ("localhost", "127.0.0.1"))
    code, _, err = sql(m, "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '" + root + "';"
                       "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;"
                       + "".join(f"CREATE DATABASE IF NOT EXISTS `{db}` DEFAULT CHARACTER SET UTF8MB4 COLLATE utf8mb4_unicode_ci;"
                                 for db in ("acore_world", "acore_characters", "acore_auth"))
                       + users + grants + f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{root}';FLUSH PRIVILEGES;",
                       password=None)
    if code:
        raise Fail("MySQL setup failed: " + err[:300])
    try:
        build_databases(m, tree, info, root, state)
        create_account(m, root, "local", "local")
        m.mysql(admin="ping")
        export_clean()
    finally:
        m.mysql(admin="shutdown")
        for _ in range(60):
            if not m.process("mysql"):
                break
            time.sleep(1)
    shutil.rmtree(tree / "data/sql/base", ignore_errors=True)
    shutil.rmtree(tree / "data/coa-world", ignore_errors=True)
    marker.unlink(missing_ok=True)


def build_databases(m, tree, info, root, state):
    manifest_order = read_json(HERE / "sql-order.json")
    # Nos SQL à la toute fin, après tous ceux de Jealous (ex. le pad Horde après zz_manastorm_snapshot_2_world).
    order = manifest_order["files"] + manifest_order.get("overlay", [])
    skip = set(info.get("freshDbSkip", []))
    # Monde : le paquet public de Jealous (data/coa-world, objets d'Ascension compris), importé par son propre outil
    # avant le premier démarrage ; sans lui, la base du dépôt (data/sql/base) n'a pas ces objets.
    world_package = (tree / "data/coa-world/baseline.json").is_file()
    if world_package:
        emit("step", step="db", text="Importing the public CoA world package (about 2 min)")
        cnf = ROOT / ".state" / "assemble-world.cnf"
        cnf.write_text(f"[client]\nuser=root\npassword={root}\nhost=127.0.0.1\nport={m.settings()['mysqlPort']}\n",
                       encoding="utf-8")
        try:
            run_tool([sys.executable, "-I", tree / "apps/coa-world/world_data.py", "bootstrap", "--defaults-file", cnf,
                      "--database", "acore_world", "--mysql", ROOT / "mysql/bin/mysql.exe"], tree, "world-bootstrap.log")
        finally:
            cnf.unlink(missing_ok=True)
    for db, folder in (("acore_auth", "db_auth"), ("acore_characters", "db_characters"), ("acore_world", "db_world")):
        if db == "acore_world" and world_package:
            continue
        files = sorted((tree / "data/sql/base" / folder).glob("*.sql"))
        emit("step", step="db", text=f"Importing {db} ({len(files)} tables)")
        for i, f in enumerate(files):
            code, _, err = sql(m, f.read_bytes(), password=root, database=db)
            if code:
                raise Fail(f"{f.name}: {err[:300]}")
            if i % 20 == 0:
                emit("progress", step="db", done=i, total=len(files), text=f"{db} {f.name}")
    skipped, total = [], len(order)
    done = 0
    for db in ("auth", "characters", "world"):
        name = "acore_" + db
        code, out, err = sql(m, "SELECT name FROM updates", password=root, database=name)
        applied = set(out.split()[1:])
        todo = [f for f in order if f["db"] == db and f["path"].rsplit("/", 1)[-1] not in applied]
        emit("step", step="db", text=f"Applying {len(todo)} updates to {name}")
        deferred = []

        def record(f, speed, state_name=None):
            fname = f["path"].rsplit("/", 1)[-1]
            # Empreinte vide : au premier démarrage le serveur la recalcule sans rejouer le fichier.
            sql(m, f"REPLACE INTO `updates` (`name`, `hash`, `state`, `speed`) VALUES ('{fname}', '', "
                   f"'{state_name or f['state']}', {speed});", password=root, database=name)

        def apply(f):
            path = tree / f["path"]
            if not path.is_file():
                return True
            start = time.time()
            code, _, err = sql(m, path.read_bytes(), password=root, database=name)
            if code:
                return err
            record(f, int((time.time() - start) * 1000))
            return True

        for f in todo:
            done += 1
            if f["path"] in skip:
                record(f, 0)
                skipped.append(f["path"])
                continue
            result = apply(f)
            if result is not True:
                deferred.append((f, result))
            if done % 50 == 0:
                emit("progress", step="db", done=done, total=total, text=f["path"].rsplit("/", 1)[-1])
        # Un fichier arrivé avant sa dépendance : réessayé à la fin, jusqu'à ce que plus rien n'avance.
        while deferred:
            still = [(f, apply(f)) for f, _ in deferred]
            still = [(f, r) for f, r in still if r is not True]
            if len(still) == len(deferred):
                raise Fail("Some database updates cannot be applied: " + "; ".join(
                    f"{f['path'].rsplit('/', 1)[-1]}: {r[:160]}" for f, r in still[:3]))
            deferred = still
    # Ce que la base characters du repack de Jealous n'a pas (il les a vidées) : les courriers de bienvenue
    # « Collector's Edition » d'AzerothCore, sinon envoyés aux nouveaux personnages.
    code, _, err = sql(m, "DELETE FROM mail_server_template_items; DELETE FROM mail_server_template_conditions; "
                          "DELETE FROM mail_server_template;", password=root, database="acore_characters")
    if code:
        raise Fail("acore_characters: " + err[:300])
    state["db"] = {"commit": info["sql"]["commit"], "skipped": skipped}


def create_account(m, root, username, password):
    salt, verifier = srp6(username, password)
    code, _, err = sql(m, "INSERT IGNORE INTO account (username, salt, verifier, expansion) VALUES "
                          f"('{username.upper()}', 0x{salt.hex()}, 0x{verifier.hex()}, 2);"
                          f"INSERT IGNORE INTO account_access (id, gmlevel, RealmID, comment) SELECT id, 3, -1, 'Default local GM' FROM account "
                          f"WHERE username = '{username.upper()}';", password=root, database="acore_auth")
    if code:
        raise Fail("Account creation failed: " + err[:300])


def export_clean():
    """Database/Clean (Clean_Database.bat) : la base neuve de CE joueur, faite par reset-database.py lui-même."""
    spec = importlib.util.spec_from_file_location("coa_reset", ROOT / "Scripts" / "reset-database.py")
    reset = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reset)
    folder = ROOT / "Database" / "Clean.new"
    fresh_dir(folder)
    info = reset.Reset(ROOT).export(folder)
    info["purpose"] = "factory-reset"
    write_json(folder / "snapshot.json", info)
    swap_in(folder, ROOT / "Database" / "Clean")


# ------------------------------------------------------------------------------------------------- commandes
def module_confs():
    """Comme « Fix » de la vérification du launcher : chaque module sans .conf reçoit la copie de son .dist."""
    for folder in (ROOT / "Core/configs/modules", ROOT / "CoA-Bots/Core/configs/modules"):
        for dist in folder.glob("*.conf.dist") if folder.is_dir() else []:
            conf = dist.with_suffix("")
            if not conf.exists():
                shutil.copy2(dist, conf)


def cmd_run(args):
    state = load_state()
    steps = [s for s in (args.steps.split(",") if args.steps else STEPS)]
    client = str(Path(args.client).resolve())
    m = manage()
    if server_running(m):
        raise Fail("Stop the server first.")
    locale = check_client(client)
    state["client"] = {"path": client, "locale": locale, "fingerprint": client_fingerprint(client)}
    save_state(state)
    for step in steps:
        if step == "client":
            continue
        t = time.time()
        {"dbc": lambda: step_dbc(client, state), "maps": lambda: step_maps(client, state),
         "vmaps": lambda: step_vmaps(client, state), "sql": lambda: step_sql(state), "db": lambda: step_db(state)}[step]()
        state.setdefault("steps", {})[step] = {"at": int(time.time()), "seconds": int(time.time() - t),
                                               "fingerprint": state["client"]["fingerprint"]}
        save_state(state)
        emit("log", step=step, text=f"{step} done in {int(time.time() - t)} s")
    module_confs()
    emit("done", steps=steps)


def cmd_status(args):
    state = load_state()
    steps = state.get("steps", {})
    mm = state.get("mmaps", {})
    total = mm.get("total") or 0
    out = {"assembled": all(s in steps for s in STEPS if s != "client") and (ROOT / "mysql/data/mysql").is_dir(),
           "steps": steps, "client": state.get("client"), "mmaps": {"done": len(mm.get("maps", {})), "total": total,
                                                                     "running": bool(mm.get("running"))},
           "db": state.get("db"), "sql": state.get("sql")}
    print(json.dumps(out, ensure_ascii=False))


def cmd_client_changed(args):
    """Le client a-t-il changé depuis la dernière extraction ? (DBC/cartes à refaire)"""
    state = load_state()
    now = client_fingerprint(str(Path(args.client).resolve()))
    print(json.dumps({"changed": state.get("steps", {}).get("dbc", {}).get("fingerprint") != now}))


def main():
    global JSON_OUT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--client", required=True)
    run.add_argument("--steps")
    mm = sub.add_parser("mmaps")
    mm.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    fs = sub.add_parser("fill-sql")
    fs.add_argument("--into", required=True)
    fs.add_argument("--manifest", required=True)
    sub.add_parser("status")
    cc = sub.add_parser("client-changed")
    cc.add_argument("--client", required=True)
    args = parser.parse_args()
    JSON_OUT = args.json
    try:
        {"run": cmd_run, "mmaps": lambda a: (step_mmaps(a.threads), emit("done", steps=["mmaps"])),
         "status": cmd_status, "client-changed": cmd_client_changed, "fill-sql": cmd_fill_sql}[args.command](args)
    except Fail as error:
        emit("error", message=str(error))
        raise SystemExit(2)
    except Exception as error:  # noqa: BLE001 - tout échec doit arriver au launcher
        emit("error", message=f"{type(error).__name__}: {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
