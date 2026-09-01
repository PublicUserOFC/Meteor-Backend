import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Friends } from '../models/Friends';
import { MakeID } from '../core/utils';
import { createProfiles } from '../core/profile';
import { backend } from '../core/logger';

interface RegisterResult {
  status: number;
  message: string;
  accountId?: string;
}

const exchangeCodes = new Map<string, { accountId: string; expires: number }>();

export async function registerUser(
  discordId: string,
  username: string,
  email: string,
  plainPassword: string
): Promise<RegisterResult> {
  email = email.toLowerCase();

  if (!username || !email || !plainPassword) {
    return { message: 'Username, email, or password is required.', status: 400 };
  }

  if (discordId && (await User.findOne({ discordId }))) {
    return { message: 'You already created an account!', status: 400 };
  }

  if (await User.findOne({ email })) {
    return { message: 'Email is already in use.', status: 400 };
  }

  const accountId = MakeID().replace(/-/gi, '');
  const matchmakingId = MakeID().replace(/-/gi, '');

  const emailFilter = /^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/;
  if (!emailFilter.test(email)) {
    return { message: 'You did not provide a valid email address.', status: 400 };
  }

  if (username.length >= 25) {
    return { message: 'Your username must be less than 25 characters long.', status: 400 };
  }

  if (username.length < 3) {
    return { message: 'Your username must be at least 3 characters long.', status: 400 };
  }

  if (plainPassword.length >= 128) {
    return { message: 'Your password must be less than 128 characters long.', status: 400 };
  }

  if (plainPassword.length < 4) {
    return { message: 'Your password must be at least 4 characters long.', status: 400 };
  }

  const allowedCharacters =
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'.split('');
  for (const character of username) {
    if (!allowedCharacters.includes(character)) {
      return {
        message: 'Your username has special characters, please remove them and try again.',
        status: 400,
      };
    }
  }

  const hashedPassword = await Bun.password.hash(plainPassword);

  try {
    const user = await User.create({
      accountId,
      username,
      username_lower: username.toLowerCase(),
      email,
      password: hashedPassword,
      discordId: discordId || undefined,
      matchmakingId,
    });

    await Profile.create({
      accountId: user.accountId,
      profiles: createProfiles(user.accountId),
    });

    await Friends.create({
      accountId: user.accountId,
      list: {
        accepted: [],
        incoming: [],
        outgoing: [],
        blocked: [],
      },
    });

    backend(`New account created: ${username} (${accountId})`);

    return {
      message: `Successfully created an account with the username **${username}**`,
      status: 200,
      accountId,
    };
  } catch (err: any) {
    if (err.code === 11000) {
      return { message: 'Username or email is already in use.', status: 400 };
    }

    return {
      message: 'An unknown error has occurred, please try again later.',
      status: 400,
    };
  }
}

export async function getUserByDiscordId(discordId: string) {
  return await User.findOne({ discordId }).lean();
}

export async function getUserByAccountId(accountId: string) {
  return await User.findOne({ accountId }).lean();
}

export async function generateExchangeCode(discordId: string): Promise<{ success: boolean; code?: string; message?: string }> {
  const user = await User.findOne({ discordId });

  if (!user) {
    return { success: false, message: 'Account not found' };
  }

  const code = MakeID().replace(/-/gi, '');
  const expiresIn = 300000; // 5 minutes
  const expires = Date.now() + expiresIn;

  exchangeCodes.set(code, { accountId: user.accountId, expires });

  setTimeout(() => {
    exchangeCodes.delete(code);
  }, expiresIn);

  backend(`Exchange code generated for ${user.username}`);

  return { success: true, code };
}

export function validateExchangeCode(code: string): string | null {
  const data = exchangeCodes.get(code);

  if (!data) return null;

  if (Date.now() > data.expires) {
    exchangeCodes.delete(code);
    return null;
  }

  exchangeCodes.delete(code);
  return data.accountId;
}

export async function changeUserPassword(
  discordId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; message?: string }> {
  const user = await User.findOne({ discordId });

  if (!user) {
    return { success: false, message: 'Account not found' };
  }

  const isValidPassword = await Bun.password.verify(oldPassword, user.password);
  if (!isValidPassword) {
    return { success: false, message: 'Incorrect current password' };
  }

  if (newPassword.length < 4 || newPassword.length >= 128) {
    return { success: false, message: 'New password must be between 4 and 128 characters' };
  }

  const hashedPassword = await Bun.password.hash(newPassword);
  user.password = hashedPassword;
  await user.save();

  backend(`Password changed for ${user.username}`);

  return { success: true };
}

export async function deleteUserAccount(discordId: string): Promise<{ success: boolean; message?: string }> {
  const user = await User.findOne({ discordId });

  if (!user) {
    return { success: false, message: 'Account not found' };
  }

  const accountId = user.accountId;
  const username = user.username;

  try {
    await Profile.deleteOne({ accountId });
    
    await Friends.deleteOne({ accountId });
    
    await User.deleteOne({ discordId });

    backend(`Account deleted: ${username} (${accountId})`);

    return { success: true, message: `Account ${username} has been permanently deleted` };
  } catch (error) {
    backend(`Error deleting account ${username}:`, error);
    return { success: false, message: 'Failed to delete account. Please try again later.' };
  }
}

export async function fixUserProfile(discordId: string): Promise<{ success: boolean; message?: string }> {
  const user = await User.findOne({ discordId });

  if (!user) {
    return { success: false, message: 'Account not found' };
  }

  try {
    await Profile.deleteOne({ accountId: user.accountId });
    
    await Profile.create({
      accountId: user.accountId,
      profiles: createProfiles(user.accountId),
    });

    backend(`Profile fixed for ${user.username}`);

    return { success: true, message: `Profile has been regenerated for ${user.username}` };
  } catch (error) {
    backend(`Error fixing profile for ${user.username}:`, error);
    return { success: false, message: 'Failed to fix profile. Please try again later.' };
  }
}
