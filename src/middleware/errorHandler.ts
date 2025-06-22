import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';
import { 
  FlowmatikError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  APIResponse 
} from '../types';

const logger = new Logger('ErrorHandler');

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Error occurred:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });

  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details = null;

  if (error instanceof ValidationError) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = error.message;
    details = error.details;
  } else if (error instanceof AuthenticationError) {
    statusCode = 401;
    errorCode = 'AUTHENTICATION_ERROR';
    message = error.message;
  } else if (error instanceof AuthorizationError) {
    statusCode = 403;
    errorCode = 'AUTHORIZATION_ERROR';
    message = error.message;
  } else if (error instanceof RateLimitError) {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_ERROR';
    message = error.message;
  } else if (error instanceof FlowmatikError) {
    statusCode = error.statusCode || 500;
    errorCode = error.code;
    message = error.message;
    details = error.details;
  }

  const response: APIResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      details
    },
    metadata: {
      timestamp: new Date(),
      requestId: req.headers['x-request-id'] as string,
      version: '1.0'
    }
  };

  res.status(statusCode).json(response);
};

