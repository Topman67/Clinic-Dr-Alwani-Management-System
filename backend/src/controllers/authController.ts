import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { comparePassword } from '../utils/password';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logActivity } from '../utils/audit';

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const match = await comparePassword(password, user.passwordHash);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.userId, username: user.username, role: user.role }, env.jwtSecret, {
    expiresIn: '8h',
  });
  // log login activity
  try {
    await logActivity(user.userId, 'login');
  } catch (err) {
    // ignore
  }
  res.json({ token, role: user.role, username: user.username });
};
