/// <reference types="node" />
import "dotenv/config";
import { defineConfig } from "prisma/config";

const buildConnectionString = () => {
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DATABASE_URL } = process.env;

  if (DB_USER && DB_PASSWORD && DB_HOST && DB_PORT && DB_NAME) {
    return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${encodeURIComponent(DB_NAME)}`;
  }

  if (DATABASE_URL) {
    return DATABASE_URL;
  }

  throw new Error(
    "Database configuration missing. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME.",
  );
};

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: buildConnectionString(),
  },
});
