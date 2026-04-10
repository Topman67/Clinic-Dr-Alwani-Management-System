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
    await logActivity(req.user?.userId, `create_user:${user.userId}`);
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
    await logActivity(req.user?.userId, `update_user:${user.userId}`);
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

  const existing = await prisma.user.findUnique({ where: { userId: id }, select: { userId: true } });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { userId: id }, data: { passwordHash } });
  try {
    await logActivity(req.user?.userId, `reset_password:${id}`);
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

  const user = await prisma.user.update({ where: { userId: id }, data: { status: UserStatus.INACTIVE } });
  try {
    await logActivity(req.user?.userId, `deactivate_user:${id}`);
  } catch (_) {}

  res.json({ userId: user.userId, username: user.username, role: user.role, status: user.status });
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (id === req.user?.userId) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  const existing = await prisma.user.findUnique({ where: { userId: id } });
  if (!existing) {
    return res.status(404).json({ message: 'User not found' });
  }

  await prisma.user.delete({ where: { userId: id } });
  try {
    await logActivity(req.user?.userId, `delete_user:${id}`);
  } catch (_) {}
  res.json({ message: 'User deleted' });
};
