const express = require("express");
const router = express.Router();
const knowledgeBaseService = require("../services/knowledgeBaseService");
const {
  uploadDocument,
  handleUploadError,
  validateFile,
  extractAgentId,
} = require("../utils/uploadHelper");

/**
 * Upload document to knowledge base
 * POST /train
 * Requires: agent_id (in body) and file upload
 */
router.post("/", uploadDocument, async (req, res) => {
  try {
    const agentId = extractAgentId(req);
    validateFile(req.file);

    console.log(`Processing knowledge base upload for agent: ${agentId}`);

    // Processing options
    const options = {
      chunking: {
        chunkSize: parseInt(req.body.chunkSize) || 1000,
        overlap: parseInt(req.body.overlap) || 200,
      },
    };

    // Upload and process document
    const result = await knowledgeBaseService.uploadDocument(
      req.file.buffer,
      agentId,
      req.file.originalname,
      req.file.mimetype,
      options
    );

    res.status(200).json({
      success: true,
      message: "Document uploaded and processed successfully",
      data: result,
    });
  } catch (error) {
    console.error("Knowledge base upload error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "KNOWLEDGE_BASE_UPLOAD_ERROR",
    });
  }
});

/**
 * Search in knowledge base
 * POST /train/search
 * Requires: agent_id and query in body
 */
router.post("/search", async (req, res) => {
  try {
    const agentId = extractAgentId(req);
    const { query, limit, threshold, documentTypes } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
        code: "MISSING_QUERY",
      });
    }

    console.log(`Searching knowledge base for agent ${agentId}: "${query}"`);

    const results = await knowledgeBaseService.search(agentId, query, {
      limit: parseInt(limit) || 10,
      threshold: parseFloat(threshold) || 0.5, // 0.5 is good for real embeddings (0.7+ for very similar content)
      includeContent: true,
      documentTypes: documentTypes || [],
    });

    res.status(200).json({
      success: true,
      query,
      resultsCount: results.length,
      results,
    });
  } catch (error) {
    console.error("Knowledge base search error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "SEARCH_ERROR",
    });
  }
});

/**
 * Get agent's documents
 * GET /train/documents
 * Requires: agent_id in query or header
 */
router.get("/documents", async (req, res) => {
  try {
    const agentId = extractAgentId(req);

    console.log(`Fetching documents for agent: ${agentId}`);

    const result = await knowledgeBaseService.getAgentDocuments(agentId, {
      type: req.query.type,
      format: req.query.format,
      search: req.query.search,
      offset: req.query.offset,
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Get documents error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "GET_DOCUMENTS_ERROR",
    });
  }
});

/**
 * Get knowledge base statistics
 * GET /train/stats
 * Requires: agent_id in query or header
 */
router.get("/stats", async (req, res) => {
  try {
    const agentId = extractAgentId(req);

    console.log(`Fetching stats for agent: ${agentId}`);

    const stats = await knowledgeBaseService.getAgentStats(agentId);

    res.status(200).json({
      success: true,
      agentId,
      stats,
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "GET_STATS_ERROR",
    });
  }
});

/**
 * Delete document from knowledge base
 * DELETE /train/documents/:documentId
 * Requires: agent_id in body/query/header
 */
router.delete("/documents/:documentId", async (req, res) => {
  try {
    const agentId = extractAgentId(req);
    const { documentId } = req.params;

    console.log(`Deleting document ${documentId} for agent: ${agentId}`);

    await knowledgeBaseService.deleteDocument(agentId, documentId);

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      documentId,
    });
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "DELETE_DOCUMENT_ERROR",
    });
  }
});

/**
 * DEBUG ENDPOINT: Verify agent-specific retrieval
 * POST /train/debug/verify
 * Requires: agent_id and query in body
 * Returns: Raw retrieved chunks with full metadata to prove retrieval filtering works
 */
router.post("/debug/verify", async (req, res) => {
  try {
    const agentId = extractAgentId(req);
    const { query, limit, threshold } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
        code: "MISSING_QUERY",
      });
    }

    console.log("\n========== DEBUG VERIFICATION ENDPOINT ==========");
    console.log(`Agent ID (from request): ${agentId}`);
    console.log(`Query: "${query}"`);
    console.log(`Limit: ${limit || 5}`);
    console.log(`Threshold: ${threshold || 0.3}`);
    console.log("================================================\n");

    // Call search with debug mode (lower threshold for testing)
    const results = await knowledgeBaseService.search(agentId, query, {
      limit: parseInt(limit) || 5,
      threshold: parseFloat(threshold) || 0.3, // Lower threshold for debugging
      includeContent: true,
      documentTypes: [],
    });

    // Return raw data with full metadata for debugging
    res.status(200).json({
      success: true,
      debug: true,
      request: {
        agentId,
        query,
        limit: parseInt(limit) || 5,
        threshold: parseFloat(threshold) || 0.3,
      },
      resultsCount: results.length,
      matches: results.map((result) => ({
        score: result.score,
        chunkId: result.chunkId,
        documentId: result.documentId,
        agentId: agentId, // Explicitly show which agent this belongs to
        text: result.chunk.substring(0, 500), // First 500 chars
        fullText: result.chunk, // Complete chunk text
        metadata: {
          ...result.metadata,
          documentName: result.document?.name,
          documentType: result.document?.type,
        },
      })),
      message:
        results.length > 0
          ? `✅ Successfully retrieved ${results.length} chunks for agent ${agentId}`
          : `⚠️ No chunks found for agent ${agentId} with query "${query}"`,
    });
  } catch (error) {
    console.error("Debug verification error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: "DEBUG_VERIFICATION_ERROR",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Error handling middleware
router.use(handleUploadError);

module.exports = router;
