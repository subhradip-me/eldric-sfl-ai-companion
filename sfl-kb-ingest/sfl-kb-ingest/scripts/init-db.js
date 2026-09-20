const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemaPath = path.resolve(__dirname, "../schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("Applying schema.sql to PostgreSQL database...");
  await pool.query(sql);
  console.log("✅ Schema applied successfully: kb_documents and kb_chunks are ready!");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to apply schema:", err);
  process.exit(1);
});
