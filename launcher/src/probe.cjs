'use strict';
// Is a port of the server open? The worlds, the authserver and MySQL listen on the address of their config (BindIP,
// Ra.IP, bind-address): 0.0.0.0 or empty answers on 127.0.0.1, a precise address (the LAN IP of the PC, 127.0.0.2)
// answers only there. 127.0.0.1 is tried first, then the precise addresses read in the repack's configs.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const FILES = ['Settings/worldserver.conf.template', 'Settings/authserver.conf.template', 'CoA-Bots/Core/configs/worldserver.conf',
  'Core/configs/worldserver.conf', 'Core/configs/authserver.conf', 'mysql/my.ini'];
const LINE = /^[ \t]*(?:BindIP|Ra\.IP|bind-address)[ \t]*=[ \t]*"?([^"\r\n#;]*)/gim;
const ANY = new Set(['', '0.0.0.0', '::', '127.0.0.1', 'localhost']);

let probeRoot = '';
const cache = new Map();
function setRoot(root) { probeRoot = root ? path.resolve(root) : ''; }

// The precise addresses of a repack (read again at most every 10 seconds).
function hosts(root = probeRoot) {
  if (!root) return [];
  const seen = cache.get(root);
  if (seen && Date.now() - seen.at < 10000) return seen.hosts;
  const found = new Set();
  for (const file of FILES) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(LINE)) {
      const ip = m[1].trim();
      if (!ANY.has(ip) && net.isIP(ip)) found.add(ip);
    }
  }
  const list = [...found];
  cache.set(root, { at: Date.now(), hosts: list });
  return list;
}

function connects(host, port, timeout = 800) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port, timeout });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// The address a port answers on ('' when closed).
async function hostOf(port, root = probeRoot) {
  if (!port) return '';
  for (const host of ['127.0.0.1', ...hosts(root)]) if (await connects(host, port)) return host;
  return '';
}
const portOpen = async (port, root = probeRoot) => !!(await hostOf(port, root));

module.exports = { portOpen, hostOf, hosts, setRoot };
