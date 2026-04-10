import { prisma } from '../config/prisma';

export const logActivity = async (userId: number | undefined, activityType: string) => {
  try {
    await prisma.auditLog.create({ data: { userId: userId ?? undefined, activityType } });
  } catch (err) {
    // swallow errors to avoid breaking main flow; server logs
    // eslint-disable-next-line no-console
    console.error('Failed to log activity', err);
  }
};
