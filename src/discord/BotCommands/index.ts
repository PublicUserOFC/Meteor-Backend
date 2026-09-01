import { BotCommand } from './types';
import { command as register } from './register';
import { command as account } from './account';
import { command as exchangecode } from './exchangecode';
import { command as changepassword } from './changepassword';
import { command as deleteaccount } from './deleteaccount';
import { command as fixprofile } from './fixprofile';
import { command as banUnban } from './ban-unban';
import { command as sethype } from './sethype';
import { command as givevbucks } from './givevbucks';

export const commands: BotCommand[] = [
  register,
  account,
  exchangecode,
  changepassword,
  deleteaccount,
  fixprofile,
  banUnban,
  sethype,
  givevbucks,
];

export const commandMap = new Map<string, BotCommand>(
  commands.map(cmd => [cmd.data.name, cmd])
);
