import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        username: string;
        role: Role;
      };
    }
  }
}

export {};
