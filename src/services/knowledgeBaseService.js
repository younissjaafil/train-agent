const s3Service = require("./s3Service");
const documentProcessor = require("./documentProcessorService");
const instanceManager = require("../utils/instanceManager");

class KnowledgeBaseService {
  constructor() {
    // In production, this would connect to a vector database like Pinecone, Weaviate, or Chroma
    this.vectorStore = new Map(); // Temporary in-memory storage
    this.userKnowledgeBases = new Map(); // User-specific knowledge bases
  }

  /**
   * Upload and process document for knowledge base
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} userId - User ID
   * @param {string} originalName - Original filename
   * @param {string} mimetype - File MIME type
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Upload and processing result
   */
  async uploadDocument(
    fileBuffer,
    userId,
    originalName,
    mimetype,
    options = {}
  ) {
    try {
      // Validate file type
      if (!documentProcessor.isSupported(mimetype, originalName)) {
        throw new Error(`Unsupported file type: ${originalName}`);
      }

      console.log(`Processing document for user ${userId}: ${originalName}`);

      // Upload to S3 with organized folder structure
      const s3Result = await s3Service.uploadDocument(
        fileBuffer,
        userId,
        originalName,
        mimetype
      );

      // Process document for RAG
      const ragResult = await documentProcessor.processForRAG(
        fileBuffer,
        mimetype,
        originalName,
        options
      );

      // Store in vector database (in-memory for now)
      const documentId = `${userId}_${Date.now()}_${originalName.replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}`;

      const knowledgeEntry = {
        id: documentId,
        userId,
        originalName,
        mimetype,
        s3Key: s3Result.key,
        s3Url: s3Result.publicUrl,
        folderType: s3Result.folderType,
        content: ragResult.content,
        chunks: ragResult.chunks,
        embeddings: ragResult.embeddings,
        metadata: {
          ...ragResult.metadata,
          ...ragResult.ragMetadata,
          uploadedAt: new Date().toISOString(),
          fileSize: fileBuffer.length,
          folderType: s3Result.folderType,
        },
        type: ragResult.type,
        format: ragResult.format,
      };

      // Store in user's knowledge base
      if (!this.userKnowledgeBases.has(userId)) {
        this.userKnowledgeBases.set(userId, new Map());
      }
      this.userKnowledgeBases.get(userId).set(documentId, knowledgeEntry);

      // Store embeddings in vector store
      ragResult.embeddings.forEach((embeddingData, index) => {
        const vectorId = `${documentId}_chunk_${index}`;
        this.vectorStore.set(vectorId, {
          id: vectorId,
          documentId,
          userId,
          embedding: embeddingData.embedding,
          chunk: embeddingData.chunk,
          metadata: {
            ...embeddingData.metadata,
            chunkIndex: index,
            documentName: originalName,
          },
        });
      });

      console.log(
        `Successfully processed document ${documentId} with ${ragResult.embeddings.length} chunks`
      );

      return {
        success: true,
        documentId,
        document: {
          id: documentId,
          name: originalName,
          type: ragResult.type,
          format: ragResult.format,
          s3Url: s3Result.publicUrl,
          s3Key: s3Result.key,
          folderType: s3Result.folderType,
          chunksCount: ragResult.chunks.length,
          metadata: knowledgeEntry.metadata,
        },
        upload: s3Result,
        processing: {
          contentLength: ragResult.content.length,
          chunksGenerated: ragResult.chunks.length,
          embeddingsGenerated: ragResult.embeddings.length,
        },
      };
    } catch (error) {
      console.error("Knowledge base upload error:", error);
      throw new Error(`Failed to process document: ${error.message}`);
    }
  }

  /**
   * Search in user's knowledge base
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(userId, query, options = {}) {
    try {
      const {
        limit = 10,
        threshold = 0.7,
        includeContent = true,
        documentTypes = [],
      } = options;

      console.log(`Searching knowledge base for user ${userId}: "${query}"`);

      // Generate query embedding (placeholder)
      const queryEmbedding = this.generateQueryEmbedding(query);

      // Find user's documents
      const userKB = this.userKnowledgeBases.get(userId);
      if (!userKB) {
        return [];
      }

      // Search through vector store
      const results = [];
      for (const [vectorId, vectorData] of this.vectorStore) {
        if (vectorData.userId !== userId) continue;

        // Filter by document type if specified
        if (documentTypes.length > 0) {
          const doc = userKB.get(vectorData.documentId);
          if (!doc || !documentTypes.includes(doc.type)) continue;
        }

        // Calculate similarity (cosine similarity placeholder)
        const similarity = this.calculateSimilarity(
          queryEmbedding,
          vectorData.embedding
        );

        if (similarity >= threshold) {
          results.push({
            score: similarity,
            documentId: vectorData.documentId,
            chunkId: vectorData.id,
            chunk: vectorData.chunk,
            metadata: vectorData.metadata,
          });
        }
      }

      // Sort by similarity score
      results.sort((a, b) => b.score - a.score);

      // Limit results
      const limitedResults = results.slice(0, limit);

      // Add document information if requested
      if (includeContent) {
        for (const result of limitedResults) {
          const doc = userKB.get(result.documentId);
          if (doc) {
            result.document = {
              name: doc.originalName,
              type: doc.type,
              format: doc.format,
              uploadedAt: doc.metadata.uploadedAt,
            };
          }
        }
      }

      console.log(`Found ${limitedResults.length} relevant chunks for query`);
      return limitedResults;
    } catch (error) {
      console.error("Knowledge base search error:", error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Get user's knowledge base documents
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} List of documents
   */
  async getUserDocuments(userId, filters = {}) {
    try {
      const userKB = this.userKnowledgeBases.get(userId);
      if (!userKB) {
        return [];
      }

      let documents = Array.from(userKB.values());

      // Apply filters
      if (filters.type) {
        documents = documents.filter((doc) => doc.type === filters.type);
      }

      if (filters.format) {
        documents = documents.filter((doc) => doc.format === filters.format);
      }

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        documents = documents.filter(
          (doc) =>
            doc.originalName.toLowerCase().includes(searchTerm) ||
            doc.content.toLowerCase().includes(searchTerm)
        );
      }

      // Sort by upload date (newest first)
      documents.sort(
        (a, b) =>
          new Date(b.metadata.uploadedAt) - new Date(a.metadata.uploadedAt)
      );

      // Apply pagination
      const offset = parseInt(filters.offset) || 0;
      const limit = parseInt(filters.limit) || 20;
      const paginatedDocs = documents.slice(offset, offset + limit);

      return {
        documents: paginatedDocs.map((doc) => ({
          id: doc.id,
          name: doc.originalName,
          type: doc.type,
          format: doc.format,
          s3Url: doc.s3Url,
          chunksCount: doc.chunks.length,
          contentLength: doc.content.length,
          uploadedAt: doc.metadata.uploadedAt,
          fileSize: doc.metadata.fileSize,
        })),
        pagination: {
          total: documents.length,
          offset,
          limit,
          hasMore: offset + limit < documents.length,
        },
      };
    } catch (error) {
      console.error("Get user documents error:", error);
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  /**
   * Delete document from knowledge base
   * @param {string} userId - User ID
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteDocument(userId, documentId) {
    try {
      const userKB = this.userKnowledgeBases.get(userId);
      if (!userKB || !userKB.has(documentId)) {
        throw new Error("Document not found");
      }

      const document = userKB.get(documentId);

      // Delete from S3
      await s3Service.deleteImage(document.s3Key);

      // Remove from vector store
      for (const [vectorId, vectorData] of this.vectorStore) {
        if (vectorData.documentId === documentId) {
          this.vectorStore.delete(vectorId);
        }
      }

      // Remove from user's knowledge base
      userKB.delete(documentId);

      console.log(`Deleted document ${documentId} for user ${userId}`);
      return true;
    } catch (error) {
      console.error("Delete document error:", error);
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  /**
   * Generate query embedding (placeholder)
   * @param {string} query - Search query
   * @returns {Array} Query embedding
   */
  generateQueryEmbedding(query) {
    // In production, use actual embedding service
    return Array(1536)
      .fill(0)
      .map(() => Math.random());
  }

  /**
   * Calculate similarity between embeddings (placeholder)
   * @param {Array} embedding1 - First embedding
   * @param {Array} embedding2 - Second embedding
   * @returns {number} Similarity score
   */
  calculateSimilarity(embedding1, embedding2) {
    // Simple cosine similarity placeholder
    // In production, use proper vector similarity calculation
    return Math.random() * 0.5 + 0.5; // Random score between 0.5-1.0
  }

  /**
   * Get knowledge base statistics for user
   * @param {string} userId - User ID
   * @returns {Object} Statistics
   */
  getUserStats(userId) {
    const userKB = this.userKnowledgeBases.get(userId);
    if (!userKB) {
      return {
        totalDocuments: 0,
        totalChunks: 0,
        documentTypes: {},
        totalSize: 0,
      };
    }

    const documents = Array.from(userKB.values());
    const stats = {
      totalDocuments: documents.length,
      totalChunks: documents.reduce((sum, doc) => sum + doc.chunks.length, 0),
      documentTypes: {},
      totalSize: documents.reduce((sum, doc) => sum + doc.metadata.fileSize, 0),
    };

    // Count by type
    documents.forEach((doc) => {
      stats.documentTypes[doc.type] = (stats.documentTypes[doc.type] || 0) + 1;
    });

    return stats;
  }
}

module.exports = new KnowledgeBaseService();
