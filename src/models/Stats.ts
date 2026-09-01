import mongoose, { Schema, Document } from 'mongoose';

export interface IArena extends Document {
    accountId: string;
    hype: number;
    division: number;
}

const ArenaSchema = new Schema<IArena>({
    accountId: { type: String, required: true, unique: true },
    hype: { type: Number, default: 0 },
    division: { type: Number, default: 1 },
}, { timestamps: true });

export const Arena = mongoose.model<IArena>('Arena', ArenaSchema);

interface PlaylistStats {
    kills: number; score: number; matchesplayed: number; minutesplayed: number; playersoutlived: number;
    placetop1?: number; placetop3?: number; placetop5?: number; placetop6?: number;
    placetop10?: number; placetop12?: number; placetop25?: number;
}

export interface IUserStats extends Document {
    accountId: string;
    solo: PlaylistStats; duo: PlaylistStats; squad: PlaylistStats;
    ltm: { wins: number; kills: number; matchesplayed: number; minutesplayed: number; playersoutlived: number; score: number };
    [key: string]: any;
}

const PlaylistStatsSchema = new Schema({ kills: { type: Number, default: 0 }, score: { type: Number, default: 0 }, matchesplayed: { type: Number, default: 0 }, minutesplayed: { type: Number, default: 0 }, playersoutlived: { type: Number, default: 0 }, placetop1: { type: Number, default: 0 }, placetop3: { type: Number, default: 0 }, placetop5: { type: Number, default: 0 }, placetop6: { type: Number, default: 0 }, placetop10: { type: Number, default: 0 }, placetop12: { type: Number, default: 0 }, placetop25: { type: Number, default: 0 } }, { _id: false });

const UserStatsSchema = new Schema<IUserStats>({ accountId: { type: String, required: true, unique: true }, solo: { type: PlaylistStatsSchema, default: () => ({}) }, duo: { type: PlaylistStatsSchema, default: () => ({}) }, squad: { type: PlaylistStatsSchema, default: () => ({}) }, ltm: { wins: { type: Number, default: 0 }, kills: { type: Number, default: 0 }, matchesplayed: { type: Number, default: 0 }, minutesplayed: { type: Number, default: 0 }, playersoutlived: { type: Number, default: 0 }, score: { type: Number, default: 0 } } }, { strict: false });

export const UserStats = mongoose.model<IUserStats>('UserStats', UserStatsSchema);
export default UserStats;
