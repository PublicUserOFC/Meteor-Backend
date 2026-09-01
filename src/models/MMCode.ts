import mongoose, { Schema, Document } from 'mongoose';

export interface IMMCode extends Document {
    code: string;
    code_lower: string;
    ip: string;
    port: number;
    createdAt: Date;
}

const MMCodeSchema: Schema = new Schema({
    code: { type: String, required: true, unique: true },
    code_lower: { type: String, required: true, unique: true },
    ip: { type: String, required: true },
    port: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IMMCode>('MMCode', MMCodeSchema);
