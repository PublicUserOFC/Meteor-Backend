import { debug, backend } from './logger';

export interface GameServer {
    ip: string;
    port: number;
    playlist: string;
    region: string;
    playerCount: number;
    maxPlayers: number;
    ready: boolean;
    registeredAt: Date;
    lastHeartbeat: Date;
    sessionId: string;
}

const servers = new Map<string, GameServer>();
const HEARTBEAT_TIMEOUT_MS = 30000;

export function registerServer(server: Omit<GameServer, 'registeredAt' | 'lastHeartbeat'>): string {
    const key = `${server.ip}:${server.port}`;
    servers.set(key, {
        ...server,
        registeredAt: new Date(),
        lastHeartbeat: new Date(),
    });
    backend(`[ServerRegistry] Server registered: ${key} | Playlist: ${server.playlist} | Ready: ${server.ready}`);
    return key;
}

export function heartbeat(ip: string, port: number, playerCount?: number): boolean {
    const key = `${ip}:${port}`;
    const server = servers.get(key);
    if (!server) return false;
    server.lastHeartbeat = new Date();
    if (playerCount !== undefined) server.playerCount = playerCount;
    return true;
}

export function setReady(ip: string, port: number, ready: boolean): boolean {
    const key = `${ip}:${port}`;
    const server = servers.get(key);
    if (!server) return false;
    if (server.ready !== ready) {
        server.ready = ready;
        backend(`[ServerRegistry] Server ${key} is now ${ready ? 'READY' : 'NOT READY'}`);
    }
    return true;
}

export function unregisterServer(ip: string, port: number): void {
    const key = `${ip}:${port}`;
    servers.delete(key);
    backend(`[ServerRegistry] Server unregistered: ${key}`);
}

export function getReadyServer(playlist: string, region?: string): GameServer | null {
    pruneStaleServers();

    for (const server of servers.values()) {
        if (!server.ready) continue;
        const serverPlaylist = server.playlist.toLowerCase();
        const requestedPlaylist = playlist.toLowerCase();
        if (serverPlaylist !== requestedPlaylist && !serverPlaylist.includes(requestedPlaylist) && !requestedPlaylist.includes(serverPlaylist)) continue;
        if (region && server.region.toLowerCase() !== region.toLowerCase()) continue;
        if (server.playerCount >= server.maxPlayers) continue;
        return server;
    }

    return null;
}

export function getAllServers(): GameServer[] {
    pruneStaleServers();
    return Array.from(servers.values());
}

function pruneStaleServers(): void {
    const now = Date.now();
    for (const [key, server] of servers.entries()) {
        if (now - server.lastHeartbeat.getTime() > HEARTBEAT_TIMEOUT_MS) {
            servers.delete(key);
            backend(`[ServerRegistry] Server timed out and removed: ${key}`);
        }
    }
}
