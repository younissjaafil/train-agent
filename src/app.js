const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Import routes
const knowledgeBaseRoutes = require("./routes/knowledgeBaseRoutes");

// Root endpoint - API documentation
app.get("/", (req, res) => {
  res.json({
    service: "Train Agent Microservice",
    version: "1.0.0",
    description: "RAG-powered knowledge base for AI agents",
    features: [
      "✅ Real OpenAI embeddings (text-embedding-3-small)",
      "✅ PostgreSQL + pgvector for efficient similarity search",
      "✅ Document processing (PDF, DOCX, TXT, MD, URLs)",
      "✅ Semantic search with configurable thresholds",
      "✅ S3 storage with organized folder structure",
    ],
    endpoints: {
      "GET /": "API documentation (this page)",
      "GET /status": "Health check",
      "POST /train": "Upload document to knowledge base",
      "POST /train/search": "Search knowledge base with semantic similarity",
      "GET /train/documents": "List agent's documents",
      "GET /train/stats": "Get agent statistics",
      "DELETE /train/documents/:id": "Delete document from knowledge base",
    },
    examples: {
      upload: {
        method: "POST",
        url: "/train",
        contentType: "multipart/form-data",
        body: {
          agent_id: "your-agent-id",
          file: "@path/to/document.pdf",
          chunkSize: 1000,
          overlap: 200,
        },
      },
      search: {
        method: "POST",
        url: "/train/search",
        contentType: "application/json",
        body: {
          agent_id: "your-agent-id",
          query: "your search query",
          limit: 10,
          threshold: 0.5,
        },
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get("/status", (req, res) =>
  res.json({
    service: "Train Agent Microservice",
    status: "Microservice is running successfully",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  })
);

// API Routes
app.use("/train", knowledgeBaseRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.path,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
    code: err.code || "INTERNAL_ERROR",
  });
});

module.exports = app;
