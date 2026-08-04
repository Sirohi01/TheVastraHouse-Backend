import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { decodeFromBackup } from "./dbBackupCodec.js";

type Manifest = {
  generatedAt: string;
  database: string;
  collections: Array<{ name: string; count: number }>;
};

async function restoreDatabase() {
  const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));

  if (!dirArg) {
    throw new Error(
      "Usage: restoreDatabase --dir=<backup-directory> [--target-uri=<uri>] [--drop]",
    );
  }

  const dir = resolve(dirArg.slice("--dir=".length));
  const targetUriArg = process.argv.find((arg) => arg.startsWith("--target-uri="));
  const targetUri = targetUriArg ? targetUriArg.slice("--target-uri=".length) : env.MONGODB_URI;
  const shouldDrop = process.argv.includes("--drop");

  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8")) as Manifest;

  const connection = await mongoose.createConnection(targetUri).asPromise();
  const db = connection.db;

  if (!db) {
    throw new Error("Target database connection is not available");
  }

  for (const { name } of manifest.collections) {
    const raw = JSON.parse(await readFile(resolve(dir, `${name}.json`), "utf8")) as unknown[];
    const documents = raw.map((item) => decodeFromBackup(item)) as Record<string, unknown>[];

    if (shouldDrop) {
      await db.collection(name).deleteMany({});
    }

    if (documents.length) {
      await db.collection(name).insertMany(documents, { ordered: false });
    }

    console.info(`Restored ${name}: ${documents.length} document(s)`);
  }

  console.info(`Restore complete from ${dir} into ${db.databaseName}.`);
  await connection.close();
}

restoreDatabase().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
