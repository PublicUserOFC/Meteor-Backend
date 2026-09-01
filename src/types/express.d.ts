import { User } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      rawBody?: Buffer;
    }
  }

  const Bun: {
    password: {
      hash(password: string, algorithm?: string): Promise<string>;
      verify(password: string, hash: string): Promise<boolean>;
    };
  };
}
