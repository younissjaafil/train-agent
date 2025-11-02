require("dotenv").config();
const app = require("./app");
const databaseService = require("./services/databaseService");
const knowledgeBaseService = require("./services/knowledgeBaseService");

const PORT = process.env.PORT;

// Initialize database connection
(async () => {
  try {
    console.log("🚀 Starting Train Agent Microservice...");

    // Initialize database
    await databaseService.initialize();
    await knowledgeBaseService.initialize();

    // Start server
    app.listen(PORT, "::", () => {
      console.log(`✅ Server listening on [::]${PORT}`);
      console.log(`📚 Knowledge Base Service ready with PostgreSQL + pgvector`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await databaseService.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await databaseService.close();
  process.exit(0);
});
