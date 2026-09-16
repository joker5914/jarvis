import { PrismaClient } from "@prisma/client";
import { CATEGORIES } from "../src/lib/config/categories";

const prisma = new PrismaClient();

async function main() {
  for (const c of CATEGORIES) {
    await prisma.tag.upsert({
      where: { ownerId_name: { ownerId: "local-user", name: c.slug } },
      update: { isSystem: true },
      create: { ownerId: "local-user", name: c.slug, isSystem: true, color: "#0ea5e9" },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} system tags`);
}

main().finally(() => prisma.$disconnect());
