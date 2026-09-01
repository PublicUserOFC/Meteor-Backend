import { Request } from 'express';

export interface User {
  accountId: string;
  username: string;
  username_lower: string;
  email: string;
  password: string;
  created: string;
  discordId?: string;
  matchmakingId: string;
  banned?: boolean;
  bannedUntil?: string;
  banReason?: string;
  isServer?: boolean;
}

export interface AuthRequest extends Request {
  user?: User;
}

export interface VersionInfo {
  season: number;
  build: number;
  CL: string;
  lobby: string;
}

export interface Token {
  accountId: string;
  token: string;
  ip?: string;
}

export interface ExchangeCode {
  accountId: string;
  exchange_code: string;
  creatingClientId: string;
}

export interface MatchmakingPlayer {
  ws: any;
  ticketId: string;
  matchId: string;
  sessionId: string;
  state: string;
}
