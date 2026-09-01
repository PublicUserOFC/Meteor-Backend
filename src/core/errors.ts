import { Response } from 'express';

export function createError(
  errorCode: string,
  errorMessage: string,
  messageVars: string[],
  numericErrorCode: number,
  error: string | undefined,
  statusCode: number,
  res: Response
): void {
  res.set({
    'X-Epic-Error-Name': errorCode,
    'X-Epic-Error-Code': numericErrorCode.toString(),
  });

  res.status(statusCode).json({
    errorCode,
    errorMessage,
    messageVars,
    numericErrorCode,
    originatingService: 'any',
    intent: 'prod',
    error_description: errorMessage,
    error,
  });
}
