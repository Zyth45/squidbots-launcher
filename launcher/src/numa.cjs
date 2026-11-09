'use strict';
// NUMA: on a machine with several NUMA nodes (two-socket servers), Windows 11 lets a process run on both processor
// groups; a worldserver whose threads run on one socket and its memory on the other went from 89 to 435 ms a tick
// (p95 176 -> 1586, Builder's bench on SQUID-SERVER). The launcher keeps worldserver and MySQL on one node: the one
// with the most free memory, or the node forced in the settings. On a machine with one node (nearly every player)
// nothing is done. Node cannot set a process's node at creation, so the process is started as usual and its default
// CPU set is limited at once to the node's processors (SetProcessDefaultCpuSetMasks, Windows 11): every thread then
// runs on that node, and its memory comes from it (Windows allocates from the node of the thread that asks).
const { execFile } = require('node:child_process');

const PS = 'powershell.exe';
// The node list: number, processor group, mask of its processors in that group, free memory.
const TOPOLOGY = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CoaNuma {
  [StructLayout(LayoutKind.Sequential)] public struct GROUP_AFFINITY { public UIntPtr Mask; public ushort Group; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public ushort[] Reserved; }
  [DllImport("kernel32.dll")] public static extern bool GetNumaHighestNodeNumber(out uint n);
  [DllImport("kernel32.dll")] public static extern bool GetNumaNodeProcessorMaskEx(ushort node, out GROUP_AFFINITY a);
  [DllImport("kernel32.dll")] public static extern bool GetNumaAvailableMemoryNodeEx(ushort node, out ulong bytes);
}
'@
$high = 0; [void][CoaNuma]::GetNumaHighestNodeNumber([ref]$high)
$out = @()
for ($n = 0; $n -le $high; $n++) {
  $a = New-Object CoaNuma+GROUP_AFFINITY; $free = [uint64]0
  if (-not [CoaNuma]::GetNumaNodeProcessorMaskEx([uint16]$n, [ref]$a)) { continue }
  [void][CoaNuma]::GetNumaAvailableMemoryNodeEx([uint16]$n, [ref]$free)
  if ($a.Mask.ToUInt64() -eq 0) { continue }
  $out += [pscustomobject]@{ node = $n; group = [int]$a.Group; mask = $a.Mask.ToUInt64().ToString(); free = $free.ToString() }
}
ConvertTo-Json -Compress -InputObject @($out)
`;
// Keeps a running process on one node: its default CPU set = the node's processors. pid: a number, or the
// launcher's own PowerShell expression ($found.Id, see PIN_NEW).
const PIN = (pid, group, mask) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CoaNumaPin {
  [StructLayout(LayoutKind.Sequential)] public struct GROUP_AFFINITY { public UIntPtr Mask; public ushort Group; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public ushort[] Reserved; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetProcessDefaultCpuSetMasks(IntPtr process, GROUP_AFFINITY[] masks, ushort count);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
$h = [CoaNumaPin]::OpenProcess(0x3000, $false, ${typeof pid === 'number' ? pid : '[uint32]' + pid})
if ($h -eq [IntPtr]::Zero) { throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$a = New-Object CoaNumaPin+GROUP_AFFINITY; $a.Mask = [UIntPtr][uint64]${String(BigInt(mask))}; $a.Group = ${Number(group)}; $a.Reserved = [uint16[]](0,0,0)
$ok = [CoaNumaPin]::SetProcessDefaultCpuSetMasks($h, @($a), 1)
$err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
[void][CoaNumaPin]::CloseHandle($h)
if (-not $ok) { throw "SetProcessDefaultCpuSetMasks failed: $err" }
'ok'
`;

// The repack starts its world and MySQL through Scripts\manage.py (a supervisor in between): the launcher waits for
// the real program of this repack (its name, a path under the repack, started after `since`), then pins it.
const PIN_NEW = (name, root, since, group, mask, seconds = 90) => `
$ErrorActionPreference = 'Stop'
$root = '${String(root).replace(/'/g, "''")}'.TrimEnd('\\') + '\\'
$since = [DateTimeOffset]::FromUnixTimeMilliseconds(${Number(since)}).UtcDateTime.AddSeconds(-2)
$deadline = (Get-Date).AddSeconds(${Number(seconds)})
$found = $null
do {
  $found = Get-Process -Name '${String(name).replace(/[^A-Za-z0-9_.-]/g, '')}' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and $_.StartTime.ToUniversalTime() -ge $since } | Select-Object -First 1
  if (-not $found) { Start-Sleep -Milliseconds 200 }
} while (-not $found -and (Get-Date) -lt $deadline)
if (-not $found) { throw 'not started' }
${PIN('$found.Id', group, mask)}
`;

const run = (script, exec = execFile) => new Promise((resolve, reject) => exec(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 30000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split(/\r?\n/).pop())) : resolve(String(stdout).trim()))));

// The nodes as PowerShell gave them; anything malformed is left out.
function parseTopology(text) {
  let list;
  try { list = JSON.parse(text || '[]'); } catch { return []; }
  if (!Array.isArray(list)) list = [list];
  return list.filter(item => item && Number.isInteger(item.node) && Number.isInteger(item.group) && /^\d+$/.test(String(item.mask)) && /^\d+$/.test(String(item.free)) && BigInt(item.mask) > 0n)
    .map(item => ({ node: item.node, group: item.group, mask: String(item.mask), free: Number(item.free) }));
}

// The node to use, or null when there is nothing to choose (one node). forced: 'auto' or a node number.
function chooseNode(nodes, forced = 'auto') {
  if (!Array.isArray(nodes) || nodes.length < 2) return null;
  if (Number.isInteger(forced)) { const node = nodes.find(item => item.node === forced); if (node) return node; }
  return nodes.reduce((best, node) => (node.free > best.free ? node : best));
}

function createNuma({ exec = execFile, log = () => {}, platform = process.platform } = {}) {
  let cached = null;
  const topology = () => {
    if (platform !== 'win32') return Promise.resolve([]);
    cached ||= run(TOPOLOGY, exec).then(parseTopology, error => { log(`NUMA: topology not read (${error.message})`); return []; });
    return cached;
  };
  // Keeps the process on one node when the machine has several; one line in the launcher's log either way it acts.
  async function pin(pid, name, forced = 'auto') {
    if (!pid) return null;
    const nodes = await topology();
    const node = chooseNode(nodes, forced);
    if (!node) return null;
    try {
      await run(PIN(Number(pid), node.group, node.mask), exec);
      log(`NUMA: ${nodes.length} nodes, ${name} on node ${node.node}${Number.isInteger(forced) && forced === node.node ? ' (chosen in the settings)' : ''}`);
      return node.node;
    } catch (error) {
      log(`NUMA: ${nodes.length} nodes, ${name} left to Windows (${error.message})`);
      return null;
    }
  }
  // The same for a program the repack starts itself (Scripts\manage.py): the first one named `name` under `root` that
  // starts after `since` (ms) is pinned, within 90 s.
  async function pinNew(name, root, since, forced = 'auto') {
    const nodes = await topology();
    const node = chooseNode(nodes, forced);
    if (!node) return null;
    try {
      await run(PIN_NEW(name, root, since, node.group, node.mask), exec);
      log(`NUMA: ${nodes.length} nodes, ${name}.exe on node ${node.node}${Number.isInteger(forced) && forced === node.node ? ' (chosen in the settings)' : ''}`);
      return node.node;
    } catch (error) {
      log(`NUMA: ${nodes.length} nodes, ${name}.exe left to Windows (${error.message})`);
      return null;
    }
  }
  return { topology, pin, pinNew, nodes: async () => (await topology()).map(({ node, free }) => ({ node, free })) };
}

module.exports = { createNuma, chooseNode, parseTopology, PIN, PIN_NEW, TOPOLOGY };
