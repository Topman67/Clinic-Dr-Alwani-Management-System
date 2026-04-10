import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) {
    return res.end();
  }
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ message });
};
