import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { encodeForBackup } from "./dbBackupCodec.js";

type Manifest = {
  generatedAt: string;
  database: string;
  collections: Array<{ name: string; count: number }>;
};

async function backupDatabase() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("Database connection is not available");
  }

  const databaseName = db.databaseName;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDirArg = process.argv.find((arg) => arg.startsWith("--dir="));
  const outDir = resolve(
    outDirArg ? outDirArg.slice("--dir=".length) : `backups/${databaseName}-${timestamp}`,
  );

  await mkdir(outDir, { recursive: true });

  const collections = await db.listCollections().toArray();
  const manifest: Manifest = { collections: [], database: databaseName, generatedAt: timestamp };

  for (const { name } of collections) {
    if (name.startsWith("system.")) {
      continue;
    }

    const documents = await db.collection(name).find({}).toArray();
    const encoded = documents.map((document) => encodeForBackup(document));
    await writeFile(resolve(outDir, `${name}.json`), JSON.stringify(encoded), "utf8");
    manifest.collections.push({ count: documents.length, name });
    console.info(`Backed up ${name}: ${documents.length} document(s)`);
  }

  await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.info(`Backup complete. Output directory: ${outDir}`);
}

backupDatabase()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
