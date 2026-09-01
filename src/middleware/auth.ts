import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { createError } from '../core/errors';
import { AuthRequest } from '../types';

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    createError(
      'errors.com.epicgames.common.authentication.authentication_failed',
      'Authentication failed',
      [],
      1032,
      'invalid_token',
      401,
      res
    );
    return;
  }

  const token = authHeader.replace('bearer ', '').replace('eg1~', '');

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    req.user = decoded;
    next();
  } catch (error) {
    createError(
      'errors.com.epicgames.common.authentication.token_verification_failed',
      'Sorry, we could not validate your token. Please try again with a new token.',
      [],
      1014,
      'invalid_token',
      401,
      res
    );
  }
}

export function verifyClient(req: Request, res: Response, next: NextFunction): void {
  next();
}
