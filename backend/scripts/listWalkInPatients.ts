import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: 'walkin', mode: 'insensitive' } },
        { name: { contains: 'walk-in', mode: 'insensitive' } },
        { icOrPassport: { contains: 'WALKIN', mode: 'insensitive' } },
      ],
    },
    select: {
      patientId: true,
      name: true,
      icOrPassport: true,
      phone: true,
    },
    orderBy: { patientId: 'asc' },
  });

  console.log(rows);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
