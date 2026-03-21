import "server-only";

import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "@/db/types";

const globalForDb = globalThis as unknown as {
  db: Kysely<DB> | undefined;
};

export const db =
  globalForDb.db ??
  new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: process.env.DATABASE_URL,
      }),
    }),
    plugins: [new CamelCasePlugin()],
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
