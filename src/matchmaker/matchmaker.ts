import WebSocket from 'ws';
import { MakeID, sleep, PlaylistNames } from '../core/utils';
import { MatchmakingPlayer } from '../types';
import { getReadyServer, getAllServers } from '../core/serverRegistry';
import { config } from '../config';
import { backend } from '../core/logger';

interface QueuedPlayer extends MatchmakingPlayer {
    playlist?: string;
}

let queue: QueuedPlayer[] = [];
let pollTimer: NodeJS.Timeout | null = null;

function resolveServer(playlist: string | null) {
    // Try registered dynamic servers first (includes probe-registered Reboot Ultimate)
    if (playlist) {
        const registered = getReadyServer(playlist);
        if (registered) return { ip: registered.ip, port: registered.port, playlist: registered.playlist };
    } else {
        for (const server of getAllServers()) {
            if (server.ready) return { ip: server.ip, port: server.port, playlist: server.playlist };
        }
    }

    // Fall back to static config — only if no probe-registered server found
    const needle = playlist?.toLowerCase();
    for (const entry of config.matchmaking.gameServerIPs) {
        const parts = entry.split(':');
        if (parts.length < 3) continue;
        const [ip, port, entryPlaylist] = parts;
        const entryLower = entryPlaylist.toLowerCase();
        if (!needle || entryLower === needle || PlaylistNames(entryLower).toLowerCase() === needle) {
            return { ip, port: parseInt(port), playlist: entryPlaylist };
        }
    }

    if (config.matchmaking.gameServerIPs.length > 0) {
        const parts = config.matchmaking.gameServerIPs[0].split(':');
        if (parts.length >= 2) {
            return { ip: parts[0], port: parseInt(parts[1]), playlist: parts[2] || playlist || 'playlist_defaultsolo' };
        }
    }

    return null;
}

export async function handleMatchmaking(ws: WebSocket, playlist?: string): Promise<void> {
    const ticketId = MakeID().replace(/-/gi, '');
    const matchId = MakeID().replace(/-/gi, '');
    const sessionId = MakeID().replace(/-/gi, '');

    const player: QueuedPlayer = { ws, ticketId, matchId, sessionId, state: 'Connecting', playlist };
    queue.push(player);

    ws.on('close', () => {
        queue = queue.filter(p => p.ws !== ws);
    });

    send(ws, 'StatusUpdate', { state: 'Connecting' });
    await sleep(200);
    send(ws, 'StatusUpdate', { totalPlayers: 1, connectedPlayers: 1, state: 'Waiting' });
    await sleep(200);

    player.state = 'Queued';
    send(ws, 'StatusUpdate', {
        ticketId,
        queuedPlayers: queue.length,
        estimatedWaitSec: 1,
        status: {},
        state: 'Queued',
    });

    startPolling();
}

function startPolling(): void {
    if (pollTimer) return;

    pollTimer = setInterval(() => {
        if (queue.length === 0) {
            clearInterval(pollTimer!);
            pollTimer = null;
            return;
        }

        const toSend: QueuedPlayer[] = [];

        for (const player of queue) {
            if (player.state !== 'Queued') continue;
            const server = resolveServer(player.playlist || null);
            if (server) {
                toSend.push(player);
            } else {
                // No ready server yet — keep player queued and log once
                if (!('_waitLogged' in player)) {
                    (player as any)._waitLogged = true;
                    backend(`[Matchmaker] No ready game server yet — player ${player.ticketId} waiting`);
                }
            }
        }

        if (toSend.length === 0) return;

        queue = queue.filter(p => !toSend.includes(p));

        toSend.forEach(async p => {
            const server = resolveServer(p.playlist || null)!;
            backend(`[Matchmaker] Sending player ${p.ticketId} to ${server.ip}:${server.port}`);
            send(p.ws, 'StatusUpdate', { matchId: p.matchId, state: 'SessionAssignment' });
            await sleep(300);
            send(p.ws, 'Play', {
                matchId: p.matchId,
                sessionId: p.sessionId,
                joinDelaySec: 1,
                serverAddress: server.ip,
                serverPort: server.port,
            });
        });

        if (queue.length === 0) {
            clearInterval(pollTimer!);
            pollTimer = null;
        }
    }, 500);
}

function send(ws: WebSocket, name: string, payload: object): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ name, payload }));
}
