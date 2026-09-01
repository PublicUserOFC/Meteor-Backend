import mongoose, { Document, Schema } from 'mongoose';

export interface IProfile extends Document {
  accountId: string;
  created: Date;
  profiles: any;
}

const profileSchema = new Schema<IProfile>({
  accountId: { type: String, required: true, unique: true, index: true },
  created: { type: Date, default: Date.now },
  profiles: { type: Schema.Types.Mixed, required: true },
});

export const Profile = mongoose.model<IProfile>('Profile', profileSchema);

export default Profile;
