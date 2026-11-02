'use strict';
// Windows 11 26H2 no longer gives the listening state in the TCP table that Scripts/manage.py reads (class 5, state 2):
// MySQL answers, yet manage.py says « still starting » and the preparation stops with « This repack does not own the
// MySQL listener ». listeners() is replaced by the one of the 2.9 package: the table of listeners only (class 3),
// IPv4 and IPv6, without the state column. Applied at the launcher's start, before every server start and preparation;
// a manage.py already fixed, or written another way, is left as it is.
const fs = require('node:fs/promises');
const path = require('node:path');

const OLD = [
  "def listeners():",
  "    api = ctypes.WinDLL(\"iphlpapi\").GetExtendedTcpTable",
  "    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL,",
  "                    wintypes.ULONG, ctypes.c_int, wintypes.ULONG]",
  "    size = wintypes.DWORD()",
  "    api(None, ctypes.byref(size), False, socket.AF_INET, 5, 0)",
  "    for _ in range(3):",
  "        buffer = ctypes.create_string_buffer(size.value)",
  "        code = api(buffer, ctypes.byref(size), False, socket.AF_INET, 5, 0)",
  "        if code == 122:",
  "            continue",
  "        if code:",
  "            raise OSError(code, \"Cannot inspect local TCP listeners\")",
  "        count = struct.unpack_from(\"<I\", buffer)[0]",
  "        rows = [struct.unpack_from(\"<6I\", buffer, 4 + 24 * i) for i in range(count)]",
  "        return [(socket.ntohs(row[2] & 65535), row[5]) for row in rows if row[0] == 2]",
  "    raise RuntimeError(\"TCP listeners changed too quickly; try again.\")",
];
const NEW = [
  "def _listener_rows(family, row_size, port_offset, pid_offset):",
  "    api = ctypes.WinDLL(\"iphlpapi\").GetExtendedTcpTable",
  "    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL,",
  "                    wintypes.ULONG, ctypes.c_int, wintypes.ULONG]",
  "    size = wintypes.DWORD()",
  "    api(None, ctypes.byref(size), False, family, 3, 0)",
  "    for _ in range(3):",
  "        buffer = ctypes.create_string_buffer(size.value)",
  "        code = api(buffer, ctypes.byref(size), False, family, 3, 0)",
  "        if code == 122:",
  "            continue",
  "        if code:",
  "            raise OSError(code, \"Cannot inspect local TCP listeners\")",
  "        count = struct.unpack_from(\"<I\", buffer)[0]",
  "        return [(socket.ntohs(struct.unpack_from(\"<I\", buffer, 4 + row_size * i + port_offset)[0] & 65535),",
  "                 struct.unpack_from(\"<I\", buffer, 4 + row_size * i + pid_offset)[0]) for i in range(count)]",
  "    raise RuntimeError(\"TCP listeners changed too quickly; try again.\")",
  "",
  "",
  "def listeners():",
  "    # TCP_TABLE_OWNER_PID_LISTENER: the state column is not reliable on every Windows build (26H2).",
  "    return _listener_rows(socket.AF_INET, 24, 8, 20) + _listener_rows(socket.AF_INET6, 56, 20, 52)",
];

// CoA-Bots/coa_common.py has its own listeners(): on 26H2 its preflight takes leftover connections (TimeWait, pid 0)
// for another program on the MySQL port (code 14). Same fix, errors still giving an empty list.
const COMMON_OLD = [
  "def listeners():",
  "    \"\"\"(port, pid) of every IPv4 TCP listener.\"\"\"",
  "    if os.name != \"nt\":",
  "        return []",
  "    api = ctypes.WinDLL(\"iphlpapi\").GetExtendedTcpTable",
  "    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL, wintypes.ULONG, ctypes.c_int,",
  "                    wintypes.ULONG]",
  "    size = wintypes.DWORD()",
  "    api(None, ctypes.byref(size), False, socket.AF_INET, 5, 0)",
  "    for _ in range(3):",
  "        buffer = ctypes.create_string_buffer(size.value)",
  "        code = api(buffer, ctypes.byref(size), False, socket.AF_INET, 5, 0)",
  "        if code == 122:",
  "            continue",
  "        if code:",
  "            return []",
  "        count = struct.unpack_from(\"<I\", buffer)[0]",
  "        rows = [struct.unpack_from(\"<6I\", buffer, 4 + 24 * i) for i in range(count)]",
  "        return [(socket.ntohs(row[2] & 65535), row[5]) for row in rows if row[0] == 2]",
  "    return []",
];
const COMMON_NEW = [
  "def _listener_rows(family, row_size, port_offset, pid_offset):",
  "    api = ctypes.WinDLL(\"iphlpapi\").GetExtendedTcpTable",
  "    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL, wintypes.ULONG, ctypes.c_int,",
  "                    wintypes.ULONG]",
  "    size = wintypes.DWORD()",
  "    api(None, ctypes.byref(size), False, family, 3, 0)",
  "    for _ in range(3):",
  "        buffer = ctypes.create_string_buffer(size.value)",
  "        code = api(buffer, ctypes.byref(size), False, family, 3, 0)",
  "        if code == 122:",
  "            continue",
  "        if code:",
  "            return []",
  "        count = struct.unpack_from(\"<I\", buffer)[0]",
  "        return [(socket.ntohs(struct.unpack_from(\"<I\", buffer, 4 + row_size * i + port_offset)[0] & 65535),",
  "                 struct.unpack_from(\"<I\", buffer, 4 + row_size * i + pid_offset)[0]) for i in range(count)]",
  "    return []",
  "",
  "",
  "def listeners():",
  "    \"\"\"(port, pid) of every TCP listener, IPv4 and IPv6.\"\"\"",
  "    if os.name != \"nt\":",
  "        return []",
  "    # TCP_TABLE_OWNER_PID_LISTENER: the state column is not reliable on every Windows build (26H2).",
  "    return _listener_rows(socket.AF_INET, 24, 8, 20) + _listener_rows(socket.AF_INET6, 56, 20, 52)",
];

// processes_under() skips its own parent only: a launcher installed inside the repack runs as several processes of
// one exe, and its others stopped every update with code 13. Every process of the parent's exe is skipped.
const PROC_OLD = [
  "    mine = {os.getpid(), os.getppid()}",
  "    out = []",
  "    for pid, exe in all_processes():",
  "        if pid in mine:",
  "            continue",
];
const PROC_NEW = [
  "    mine = {os.getpid(), os.getppid()}",
  "    seen = all_processes()",
  "    # The launcher runs as several processes of one exe, maybe inside the repack: none of them counts.",
  "    parent = next((exe for pid, exe in seen if pid == os.getppid()), None)",
  "    out = []",
  "    for pid, exe in seen:",
  "        if pid in mine or exe == parent:",
  "            continue",
];

const FIXES = [
  { parts: ['Scripts', 'manage.py'], old: OLD, fresh: NEW },
  { parts: ['CoA-Bots', 'coa_common.py'], old: COMMON_OLD, fresh: COMMON_NEW },
  { parts: ['CoA-Bots', 'coa_common.py'], old: PROC_OLD, fresh: PROC_NEW },
];

function fixText(text, old = OLD, fresh = NEW) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = old.join(eol);
  if (!text.includes(block)) return text;
  return text.replace(block, () => fresh.join(eol));
}

async function fixManage(root, fixes = FIXES) {
  if (!root) return false;
  let fixed = false;
  for (const { parts, old, fresh } of fixes) {
    const file = path.join(root, ...parts);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    const next = fixText(text, old, fresh);
    if (next === text) continue;
    // Written beside, then renamed: a power cut never leaves half a file.
    const temp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temp, next);
    await fs.rename(temp, file);
    fixed = true;
  }
  return fixed;
}

// The update package carries its own copy (update/coa_common.py): fixed once unpacked, before its tool runs.
const fixUpdateTool = target => fixManage(target, [{ parts: ['update', 'coa_common.py'], old: PROC_OLD, fresh: PROC_NEW }]);

module.exports = { fixManage, fixUpdateTool, fixText, OLD, COMMON_OLD, COMMON_NEW, PROC_OLD, PROC_NEW };
