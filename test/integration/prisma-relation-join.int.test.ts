import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/smartlists_test";

const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
const prisma = new PrismaClient({
  adapter,
  log: [{ emit: "event", level: "query" }],
});
const queries: string[] = [];
prisma.$on("query", (event) => queries.push(event.query));

afterAll(async () => {
  await prisma.$disconnect();
});

describe("relationLoadStrategy", () => {
  it("сохраняет один PostgreSQL-запрос с LATERAL JOIN для дерева списка", async () => {
    queries.length = 0;

    await prisma.list.findMany({
      take: 1,
      relationLoadStrategy: "join",
      include: {
        owner: true,
        items: {
          include: {
            addedBy: true,
          },
        },
        shares: {
          include: {
            user: true,
          },
        },
        groupMemberships: true,
        files: true,
      },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/LATERAL/i);
    expect(queries[0]).toMatch(/JSON/i);
  });
});
