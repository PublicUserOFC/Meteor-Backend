import mongoose, { Document, Schema } from 'mongoose';

interface FriendEntry {
  accountId: string;
  created: string;
  alias?: string;
}

export interface IFriends extends Document {
  accountId: string;
  created: Date;
  list: {
    accepted: FriendEntry[];
    incoming: FriendEntry[];
    outgoing: FriendEntry[];
    blocked: FriendEntry[];
  };
}

const friendEntrySchema = new Schema({
  accountId: { type: String, required: true },
  created: { type: String, required: true },
  alias: { type: String },
}, { _id: false });

const friendsSchema = new Schema<IFriends>({
  accountId: { type: String, required: true, unique: true, index: true },
  created: { type: Date, default: Date.now },
  list: {
    accepted: [friendEntrySchema],
    incoming: [friendEntrySchema],
    outgoing: [friendEntrySchema],
    blocked: [friendEntrySchema],
  },
});

export const Friends = mongoose.model<IFriends>('Friends', friendsSchema);
