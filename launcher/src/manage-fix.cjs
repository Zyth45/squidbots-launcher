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

function fixText(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const old = OLD.join(eol);
  if (!text.includes(old)) return text;
  return text.replace(old, () => NEW.join(eol));
}

async function fixManage(root) {
  if (!root) return false;
  const file = path.join(root, 'Scripts', 'manage.py');
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return false;
  const next = fixText(text);
  if (next === text) return false;
  // Written beside, then renamed: a power cut never leaves half a manage.py.
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, next);
  await fs.rename(temp, file);
  return true;
}

module.exports = { fixManage, fixText, OLD };
