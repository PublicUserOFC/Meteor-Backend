import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  accountId: string;
  username: string;
  username_lower: string;
  email: string;
  password: string;
  discordId?: string;
  matchmakingId: string;
  created: Date;
  banned: boolean;
  bannedUntil?: Date;
  banReason?: string;
  favorites: string[];
}

const userSchema = new Schema<IUser>({
  accountId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  username_lower: { type: String, required: true, index: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  discordId: { type: String, unique: true, sparse: true, index: true },
  matchmakingId: { type: String, required: true },
  created: { type: Date, default: Date.now },
  banned: { type: Boolean, default: false },
  bannedUntil: { type: Date },
  banReason: { type: String },
  favorites: { type: [String], default: [] },
});

export const User = mongoose.model<IUser>('User', userSchema);

export default User;
