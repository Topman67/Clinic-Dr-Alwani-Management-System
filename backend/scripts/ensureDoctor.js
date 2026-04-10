const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const username = 'doctor';
  const newPlain = 'admin123';

  const newHash = await bcrypt.hash(newPlain, 10);

  const upserted = await prisma.user.upsert({
    where: { username },
    update: { passwordHash: newHash, status: 'ACTIVE' },
    create: { username, passwordHash: newHash, role: 'DOCTOR', status: 'ACTIVE' },
  });

  console.log(`Upserted user: ${upserted.username} (id=${upserted.userId}). Password set to '${newPlain}'.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
