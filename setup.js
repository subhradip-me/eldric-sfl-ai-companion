import "dotenv/config";
import { pool, init } from "./server/db/database.js";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setup() {
  console.log("🌻 Sunflower AI Setup\n");

  try {
    // Initialize database connection
    console.log("📦 Connecting to database...");
    await init();
    console.log("✅ Database connected\n");

    // Read and execute schema
    console.log("📝 Creating database schema...");
    const schemaPath = path.join(__dirname, "server/db/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    // Split by semicolon and execute each statement
    const statements = schema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error) {
        // Ignore "already exists" errors
        if (!error.message.includes("already exists")) {
          console.warn(`⚠️  Warning: ${error.message}`);
        }
      }
    }
    console.log("✅ Schema created\n");

    // Create demo user
    console.log("👤 Creating demo user...");
    const demoUsername = "demo";
    const demoPassword = "demo123";
    const demoEmail = "demo@sunflower-ai.local";

    // Check if demo user exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [demoUsername]
    );

    if (existingUser.rows.length > 0) {
      console.log("ℹ️  Demo user already exists");
    } else {
      const passwordHash = await bcrypt.hash(demoPassword, 10);
      await pool.query(
        "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)",
        [demoUsername, demoEmail, passwordHash]
      );
      console.log("✅ Demo user created");
      console.log(`   Username: ${demoUsername}`);
      console.log(`   Password: ${demoPassword}`);
    }

    console.log("\n🎉 Setup complete!\n");
    console.log("Next steps:");
    console.log("1. Start the server: npm run dev");
    console.log("2. Start the client: cd client && npm run dev");
    console.log("3. Open http://localhost:5173 in your browser\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Setup failed:", error.message);
    console.error("\nPlease check:");
    console.error("- PostgreSQL is running");
    console.error("- DATABASE_URL in .env is correct");
    console.error("- Database exists and is accessible\n");
    process.exit(1);
  }
}

setup();
