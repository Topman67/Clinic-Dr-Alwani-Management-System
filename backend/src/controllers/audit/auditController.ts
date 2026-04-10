import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';

export const listAuditLogs = async (_req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: { timestamp: 'desc' },
    take: 200,
  });
  res.json(logs);
};
