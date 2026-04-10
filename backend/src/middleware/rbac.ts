import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';

export const rbac = (rolesAllowed: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });
    if (!rolesAllowed.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
};
