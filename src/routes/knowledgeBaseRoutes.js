const express = require("express");
const router = express.Router();
const knowledgeBaseService = require("../services/knowledgeBaseService");
const {
  uploadDocument,
  handleUploadError,
  validateFile,
  extractUserId,
} = require("../utils/uploadHelper");

/**
 * Upload document to knowledge base
 * POST /train
 * Requires: user_id (in body) and file upload
 */
router.post("/", uploadDocument, async (req, res) => {
  try {
    const userId = extractUserId(req);
    validateFile(req.file);

    console.log(`Processing knowledge base upload for user: ${userId}`);

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
      userId,
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
 * Requires: user_id and query in body
 */
router.post("/search", async (req, res) => {
  try {
    const userId = extractUserId(req);
    const { query, limit, threshold, documentTypes } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
        code: "MISSING_QUERY",
      });
    }

    console.log(`Searching knowledge base for user ${userId}: "${query}"`);

    const results = await knowledgeBaseService.search(userId, query, {
      limit: parseInt(limit) || 10,
      threshold: parseFloat(threshold) || 0.7,
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
 * Get user's documents
 * GET /train/documents
 * Requires: user_id in query or header
 */
router.get("/documents", async (req, res) => {
  try {
    const userId = extractUserId(req);

    console.log(`Fetching documents for user: ${userId}`);

    const result = await knowledgeBaseService.getUserDocuments(userId, {
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
 * Requires: user_id in query or header
 */
router.get("/stats", async (req, res) => {
  try {
    const userId = extractUserId(req);

    console.log(`Fetching stats for user: ${userId}`);

    const stats = knowledgeBaseService.getUserStats(userId);

    res.status(200).json({
      success: true,
      userId,
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
 * Requires: user_id in body/query/header
 */
router.delete("/documents/:documentId", async (req, res) => {
  try {
    const userId = extractUserId(req);
    const { documentId } = req.params;

    console.log(`Deleting document ${documentId} for user: ${userId}`);

    await knowledgeBaseService.deleteDocument(userId, documentId);

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

// Error handling middleware
router.use(handleUploadError);

module.exports = router;
