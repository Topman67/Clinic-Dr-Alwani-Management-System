import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'changeme',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

if (!env.databaseUrl) {
  console.warn('DATABASE_URL is not set. Please configure .env');
}
