/**
 * Game Server Probe
 *
 * Reboot Ultimate has no registration or heartbeat mechanism — it just
 * listens on a UDP port. This module probes the configured static game
 * server IPs by attempting a TCP connection to their port. When the port
 * is open the server is registered as ready; when it closes it is removed.
 *
 * Probe interval: every 5 seconds.
 * A server is considered ready after 1 successful probe.
 * A server is considered down after 3 consecutive failed probes.
 */

import net from 'net';
import { config } from '../config';
import { registerServer, heartbeat, unregisterServer } from './serverRegistry';
import { backend } from './logger';

interface ProbeTarget {
  ip: string;
  port: number;
  playlist: string;
  failCount: number;
  registered: boolean;
}

const PROBE_INTERVAL_MS = 5000;
const FAIL_THRESHOLD = 3;       // consecutive failures before marking down
const PROBE_TIMEOUT_MS = 2000;  // TCP connect timeout

const targets: ProbeTarget[] = [];

function parseTargets(): void {
  targets.length = 0;
  for (const entry of config.matchmaking.gameServerIPs) {
    const parts = entry.split(':');
    if (parts.length < 3) continue;
    const [ip, portStr, playlist] = parts;
    const port = parseInt(portStr, 10);
    if (!ip || isNaN(port) || !playlist) continue;
    // Deduplicate by ip:port
    if (!targets.find(t => t.ip === ip && t.port === port)) {
      targets.push({ ip, port, playlist, failCount: 0, registered: false });
    }
  }
}

function probePort(ip: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, ip);
  });
}

async function runProbe(): Promise<void> {
  for (const target of targets) {
    const up = await probePort(target.ip, target.port);

    if (up) {
      target.failCount = 0;

      if (!target.registered) {
        // First time we see it up — register and mark ready
        registerServer({
          ip: target.ip,
          port: target.port,
          playlist: target.playlist,
          region: 'EU',
          playerCount: 0,
          maxPlayers: 100,
          ready: true,
          sessionId: require('crypto').randomUUID().replace(/-/g, '').toUpperCase(),
        });
        target.registered = true;
        backend(`[Probe] Game server ${target.ip}:${target.port} is UP — marked READY`);
      } else {
        // Refresh heartbeat so pruneStaleServers never removes an active probe target
        heartbeat(target.ip, target.port);
      }
    } else {
      target.failCount++;

      if (target.registered && target.failCount >= FAIL_THRESHOLD) {
        unregisterServer(target.ip, target.port);
        target.registered = false;
        backend(`[Probe] Game server ${target.ip}:${target.port} is DOWN — unregistered after ${FAIL_THRESHOLD} failures`);
      } else if (!target.registered && target.failCount === 1) {
        // First failure — just log, don't spam
        backend(`[Probe] Game server ${target.ip}:${target.port} not reachable yet, waiting...`);
      }
    }
  }
}

export function startServerProbe(): void {
  parseTargets();

  if (targets.length === 0) {
    backend('[Probe] No static game server IPs configured — probe disabled');
    return;
  }

  backend(`[Probe] Watching ${targets.length} game server(s) for readiness...`);

  // Run immediately then on interval
  runProbe();
  setInterval(runProbe, PROBE_INTERVAL_MS);
}

export function getProbeStatus(): { ip: string; port: string; playlist: string; ready: boolean; failCount: number }[] {
  return targets.map(t => ({
    ip: t.ip,
    port: String(t.port),
    playlist: t.playlist,
    ready: t.registered,
    failCount: t.failCount,
  }));
}
