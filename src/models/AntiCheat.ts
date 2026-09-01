import mongoose, { Schema, Document } from 'mongoose';

export interface IDetectionLog {
    reason: string;
    details: string;
    timestamp: Date;
}

export interface IAntiCheat extends Document {
    accountId: string;
    flagCount: number;
    banned: boolean;
    detectionLogs: IDetectionLog[];
    lastDetection?: Date;
}

const DetectionLogSchema = new Schema<IDetectionLog>({
    reason: { type: String, required: true },
    details: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });

const AntiCheatSchema = new Schema<IAntiCheat>({
    accountId: { type: String, required: true, unique: true, index: true },
    flagCount: { type: Number, default: 0 },
    banned: { type: Boolean, default: false },
    detectionLogs: { type: [DetectionLogSchema], default: [] },
    lastDetection: { type: Date },
});

export default mongoose.model<IAntiCheat>('AntiCheat', AntiCheatSchema);
