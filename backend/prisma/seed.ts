import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Seeds run through DATABASE_URL (the owner role), which is why this script
// can freely insert across organizations — it's the one place in the repo
// where that's the correct role to use.
const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('password123', 10);

  const orgA = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { name: 'Acme Inc', slug: 'acme', plan: 'pro' },
  });

  const orgB = await prisma.organization.upsert({
    where: { slug: 'globex' },
    update: {},
    create: { name: 'Globex Corp', slug: 'globex', plan: 'free' },
  });

  const alice = await prisma.user.upsert({
    where: { email: 'alice@acme.test' },
    update: {},
    create: { email: 'alice@acme.test', passwordHash: password },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@globex.test' },
    update: {},
    create: { email: 'bob@globex.test', passwordHash: password },
  });

  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: orgA.id, userId: alice.id } },
    update: {},
    create: { orgId: orgA.id, userId: alice.id, role: 'admin' },
  });

  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: orgB.id, userId: bob.id } },
    update: {},
    create: { orgId: orgB.id, userId: bob.id, role: 'admin' },
  });

  await prisma.task.createMany({
    data: [
      {
        orgId: orgA.id,
        title: 'Prepare Acme Q1 report',
        createdBy: alice.id,
      },
      {
        orgId: orgB.id,
        title: 'Ship Globex onboarding flow',
        createdBy: bob.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seeded:');
  console.log('  alice@acme.test / password123  -> org "acme"');
  console.log('  bob@globex.test / password123   -> org "globex"');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
