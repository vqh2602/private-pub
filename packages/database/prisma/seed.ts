import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const publisher = await prisma.publisher.upsert({
    where: { publisherId: "platform.internal" },
    update: {},
    create: {
      publisherId: "platform.internal",
      displayName: "Platform Engineering",
      domain: "platform.internal",
      verifiedAt: new Date(),
    },
  });
  await prisma.package.upsert({
    where: { name: "aurora_ui" },
    update: {},
    create: {
      name: "aurora_ui",
      normalizedName: "aurora_ui",
      description: "Accessible design system for company Flutter apps",
      publisherId: publisher.id,
      topics: ["flutter", "design-system"],
    },
  });
  console.info("Seeded private registry demo data");
}

main().finally(() => prisma.$disconnect());
