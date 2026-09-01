import mongoose, { Schema, Document } from 'mongoose';

export interface ISACCode extends Document {
    code: string;
    code_lower: string;
    code_higher: string;
    createdAt: Date;
}

const SACCodeSchema: Schema = new Schema({
    code: { type: String, required: true, unique: true },
    code_lower: { type: String, required: true, unique: true },
    code_higher: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<ISACCode>('SACCode', SACCodeSchema);
