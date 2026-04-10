const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const username = 'doctor';
  const newPlain = 'admin123';

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`User with username '${username}' not found.`);
    process.exit(1);
  }

  const newHash = await bcrypt.hash(newPlain, 10);

  await prisma.user.update({
    where: { username },
    data: { passwordHash: newHash },
  });

  console.log(`Password for user '${username}' updated to '${newPlain}'.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
