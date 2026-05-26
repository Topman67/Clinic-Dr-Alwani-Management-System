import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { hashPassword } from '../utils/password';
import { Role, UserStatus } from '@prisma/client';
import { logActivity } from '../utils/audit';

const STAFF_ROLES: Role[] = [Role.RECEPTIONIST, Role.PHARMACIST];

const isValidRole = (role?: string): role is Role => {
  if (!role) return false;
  return Object.values(Role).includes(role as Role);
};

const isValidStatus = (status?: string): status is UserStatus => {
  if (!status) return false;
  return Object.values(UserStatus).includes(status as UserStatus);
};

export const listUsers = async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: { userId: true, username: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users);
};

export const createUser = async (req: Request, res: Response) => {
  const { username, password, role } = req.body as { username: string; password: string; role: Role };

  if (!username || username.trim().length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  if (!isValidRole(role) || !STAFF_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Only RECEPTIONIST or PHARMACIST accounts can be created here' });
  }

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) {
    return res.status(409).json({ message: 'Username already exists' });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username: username.trim(), passwordHash, role, status: UserStatus.ACTIVE },
  });
  try {
    await logActivity(req.user?.userId, `create_user:${role.toLowerCase()}_account:${user.username}:${user.userId}`);
  } catch (_) {}
  res.status(201).json({ userId: user.userId, username: user.username, role: user.role, status: user.status });
};

export const updateUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { username, role, status } = req.body as { username?: string; role?: Role; status?: UserStatus };

  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (role && !isValidRole(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  if (status && !isValidStatus(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  if (existing.userId === req.user?.userId && status === UserStatus.INACTIVE) {
    return res.status(400).json({ message: 'You cannot deactivate your own account' });
  }

  if (existing.role === Role.DOCTOR) {
    if (role && role !== Role.DOCTOR) {
      return res.status(400).json({ message: 'Primary doctor role cannot be changed.' });
    }
    if (status && status !== UserStatus.ACTIVE) {
      return res.status(400).json({ message: 'Primary doctor account cannot be deactivated.' });
    }
  } else if (role && !STAFF_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Staff role must be RECEPTIONIST or PHARMACIST.' });
  }

  const nextUsername = username?.trim();
  if (nextUsername && nextUsername.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters' });
  }

  if (nextUsername && nextUsername !== existing.username) {
    const duplicate = await prisma.user.findUnique({ where: { username: nextUsername } });
    if (duplicate) {
      return res.status(409).json({ message: 'Username already exists' });
    }
  }

  const user = await prisma.user.update({
    where: { userId: id },
    data: { username: nextUsername, role, status },
  });
  try {
    const changes: string[] = [];
    if (nextUsername && nextUsername !== existing.username) changes.push('username');
    if (role && role !== existing.role) changes.push(`role:${existing.role}->${role}`);
    if (status && status !== existing.status) changes.push(`status:${existing.status}->${status}`);
    await logActivity(req.user?.userId, `update_user:${user.userId}:${changes.join(',') || 'no_changes'}`);
  } catch (_) {}
  res.json({ userId: user.userId, username: user.username, role: user.role, status: user.status });
};

export const updatePassword = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { password } = req.body as { password: string };

  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id }, select: { userId: true, username: true, role: true } });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { userId: id }, data: { passwordHash } });
  try {
    await logActivity(req.user?.userId, `reset_password:${existing.role.toLowerCase()}_account:${existing.username}:${id}`);
  } catch (_) {}
  res.json({ message: 'Password updated' });
};

export const deactivateUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (id === req.user?.userId) {
    return res.status(400).json({ message: 'You cannot deactivate your own account' });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (existing.role === Role.DOCTOR) {
    return res.status(400).json({ message: 'Primary doctor account cannot be deactivated.' });
  }

  const user = await prisma.user.update({ where: { userId: id }, data: { status: UserStatus.INACTIVE } });
  try {
    await logActivity(req.user?.userId, `deactivate_user:${existing.role.toLowerCase()}_account:${existing.username}:${id}`);
  } catch (_) {}

  res.json({ userId: user.userId, username: user.username, role: user.role, status: user.status });
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const actingUserId = req.user?.userId;
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (!actingUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (id === actingUserId) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  const existing = await prisma.user.findUnique({
    where: { userId: id },
    select: {
      userId: true,
      role: true,
      username: true,
      _count: {
        select: {
          prescriptions: true,
          appointments: true,
          consultations: true,
          payments: true,
          auditLogs: true,
        },
      },
    },
  });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (existing.role === Role.DOCTOR) {
    return res.status(400).json({ message: 'Doctor accounts cannot be deleted.' });
  }

  const hasClinicalRecords =
    existing._count.prescriptions > 0 || existing._count.appointments > 0 || existing._count.consultations > 0;

  if (hasClinicalRecords) {
    return res.status(400).json({ message: 'Cannot delete user with clinical records.' });
  }

  await prisma.$transaction(async (tx) => {
    if (existing._count.payments > 0) {
      await tx.payment.updateMany({
        where: { recordedById: id },
        data: { recordedById: actingUserId },
      });
    }

    if (existing._count.auditLogs > 0) {
      await tx.auditLog.updateMany({
        where: { userId: id },
        data: { userId: null },
      });
    }

    await tx.user.delete({ where: { userId: id } });
  });

  try {
    await logActivity(actingUserId, `delete_user:${existing.role.toLowerCase()}_account:${existing.username}:${id}`);
  } catch (_) {}
  res.json({ message: 'User deleted' });
};
