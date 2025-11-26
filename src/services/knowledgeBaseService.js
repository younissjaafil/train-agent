const s3Service = require("./s3Service");
const documentProcessor = require("./documentProcessorService");
const databaseService = require("./databaseService");
const OpenAI = require("openai");

class KnowledgeBaseService {
  constructor() {
    // PostgreSQL with pgvector for vector storage
    this.db = databaseService;
    this.hasPgVector = null; // Will be checked on first use

    // Initialize OpenAI client for query embeddings
    this.openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

    if (!this.openai) {
      console.warn(
        "⚠️  OpenAI API key not found for query embeddings - search will use MOCK embeddings"
      );
    }
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    await this.db.initialize();

    // Check if pgvector extension is available
    try {
      const result = await this.db.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') as has_pgvector"
      );
      this.hasPgVector = result.rows[0].has_pgvector;
      console.log(
        `pgvector support: ${
          this.hasPgVector
            ? "✅ Enabled"
            : "⚠️  Not available (using TEXT storage)"
        }`
      );
    } catch (error) {
      this.hasPgVector = false;
      console.warn("Could not check pgvector availability, using TEXT storage");
    }
  }

  /**
   * Upload and process document for knowledge base
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} agentId - Agent ID (UUID or integer)
   * @param {string} originalName - Original filename
   * @param {string} mimetype - File MIME type
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Upload and processing result
   */
  async uploadDocument(
    fileBuffer,
    agentId,
    originalName,
    mimetype,
    options = {}
  ) {
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");

      // Validate file type
      if (!documentProcessor.isSupported(mimetype, originalName)) {
        throw new Error(`Unsupported file type: ${originalName}`);
      }

      console.log(`Processing document for agent ${agentId}: ${originalName}`);

      // Get or auto-create agent in database
      const dbAgentId = await this.db.getOrCreateAgentId(agentId, {
        name: `Agent ${agentId.substring(0, 8)}`,
        description: "Auto-registered agent from training upload",
      });

      console.log(`Using agent DB ID: ${dbAgentId} for UUID: ${agentId}`);

      // Get creator (user) ID from agent
      const agentResult = await client.query(
        "SELECT creator_id FROM agents WHERE id = $1",
        [dbAgentId]
      );

      if (agentResult.rows.length === 0) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      const creatorId = agentResult.rows[0].creator_id;

      // Upload to S3 with agent-specific folder structure (agentId/folderType/filename)
      const s3Result = await s3Service.uploadDocument(
        fileBuffer,
        agentId, // Use agentId directly for S3 path organization
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

      // Determine source_type from file extension/mimetype
      const sourceType = this.getSourceType(mimetype, originalName);

      // Insert into knowledge_sources table (try both column names for compatibility)
      let knowledgeResult;
      try {
        // Try with instructor_id first (original schema)
        knowledgeResult = await client.query(
          `INSERT INTO knowledge_sources 
           (instructor_id, agent_id, title, file_url, file_type, size_mb, processed) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           RETURNING id`,
          [
            creatorId,
            dbAgentId,
            originalName,
            s3Result.publicUrl,
            sourceType,
            fileBuffer.length / (1024 * 1024), // Convert to MB
            true,
          ]
        );
      } catch (error) {
        if (error.message.includes("instructor_id")) {
          // Fallback: try with creator_id or without it
          knowledgeResult = await client.query(
            `INSERT INTO knowledge_sources 
             (agent_id, title, file_url, file_type, size_mb, processed) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id`,
            [
              dbAgentId,
              originalName,
              s3Result.publicUrl,
              sourceType,
              fileBuffer.length / (1024 * 1024), // Convert to MB
              true,
            ]
          );
        } else {
          throw error;
        }
      }

      const knowledgeSourceId = knowledgeResult.rows[0].id;

      // Store training data with embeddings in agent_training_data
      for (let i = 0; i < ragResult.embeddings.length; i++) {
        const embeddingData = ragResult.embeddings[i];

        // Convert embedding array to appropriate format
        let embeddingVector;
        let insertQuery;

        if (this.hasPgVector) {
          // Use pgvector format: [1,2,3,...]
          embeddingVector = `[${embeddingData.embedding.join(",")}]`;
          insertQuery = `INSERT INTO agent_training_data 
           (agent_id, title, content, source_type, file_url, embedding_vector) 
           VALUES ($1, $2, $3, $4, $5, $6::vector)`;
        } else {
          // Use JSON string format for TEXT column
          embeddingVector = JSON.stringify(embeddingData.embedding);
          insertQuery = `INSERT INTO agent_training_data 
           (agent_id, title, content, source_type, file_url, embedding_vector) 
           VALUES ($1, $2, $3, $4, $5, $6)`;
        }

        await client.query(insertQuery, [
          dbAgentId,
          `${originalName} - Chunk ${i + 1}`,
          embeddingData.chunk,
          sourceType,
          s3Result.publicUrl,
          embeddingVector,
        ]);
      }

      await client.query("COMMIT");

      console.log(
        `✅ Successfully processed document ${knowledgeSourceId} with ${ragResult.embeddings.length} chunks`
      );
      console.log(
        `   Content: ${ragResult.content.length} chars → ${
          ragResult.chunks.length
        } chunks (avg: ${Math.round(
          ragResult.content.length / ragResult.chunks.length
        )} chars/chunk)`
      );

      return {
        success: true,
        agentId: agentId, // ✅ CRITICAL: Visual confirmation that agent_id was stored
        documentId: knowledgeSourceId,
        document: {
          id: knowledgeSourceId,
          name: originalName,
          type: ragResult.type,
          format: ragResult.format,
          s3Url: s3Result.publicUrl,
          s3Key: s3Result.key,
          folderType: s3Result.folderType,
          chunksCount: ragResult.chunks.length,
          metadata: {
            ...ragResult.metadata,
            ...ragResult.ragMetadata,
            uploadedAt: new Date().toISOString(),
            fileSize: fileBuffer.length,
            folderType: s3Result.folderType,
            agentId: agentId, // Also include in metadata for completeness
          },
        },
        upload: s3Result,
        processing: {
          contentLength: ragResult.content.length,
          chunksGenerated: ragResult.chunks.length,
          embeddingsGenerated: ragResult.embeddings.length,
          dbAgentId: dbAgentId, // Database integer ID for debugging
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Knowledge base upload error:", error);
      throw new Error(`Failed to process document: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get source type from mimetype and filename
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Filename
   * @returns {string} Source type
   */
  getSourceType(mimetype, filename) {
    if (mimetype.includes("pdf")) return "pdf";
    if (mimetype.includes("word") || mimetype.includes("document"))
      return "docx";
    if (mimetype.includes("text")) return "text";
    if (mimetype.includes("audio")) return "audio";
    if (mimetype.includes("video")) return "video";
    return "text"; // Default
  }

  /**
   * Search in agent's knowledge base using vector similarity
   * @param {string} agentId - Agent ID (UUID or integer)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(agentId, query, options = {}) {
    try {
      const {
        limit = 10,
        threshold = 0.7,
        includeContent = true,
        documentTypes = [],
      } = options;

      console.log(`Searching knowledge base for agent ${agentId}: "${query}"`);

      // Get agent database ID (don't auto-create for search - just return empty results)
      const dbAgentId = await this.db.getAgentId(agentId);
      if (!dbAgentId) {
        console.log(`Agent ${agentId} not found - returning empty results`);
        return [];
      }

      // ✅ COMPREHENSIVE LOGGING: Track search parameters
      console.log("\n========== RAG SEARCH DEBUG ==========");
      console.log(`Agent ID (UUID/input): ${agentId}`);
      console.log(`Agent ID (DB integer): ${dbAgentId}`);
      console.log(`Query: "${query}"`);
      console.log(`Query Length: ${query.length} chars`);
      console.log(`Search Options:`, {
        limit,
        threshold,
        includeContent,
        documentTypes,
      });
      console.log("======================================\n");

      // Generate query embedding (placeholder - same as before)
      const queryEmbedding = await this.generateQueryEmbedding(query);

      let result;

      if (this.hasPgVector) {
        // Use pgvector for efficient similarity search
        const embeddingVector = `[${queryEmbedding.join(",")}]`;

        let sqlQuery = `
          SELECT 
            atd.id,
            atd.title,
            atd.content,
            atd.source_type,
            atd.file_url,
            atd.created_at,
            ks.title as document_name,
            ks.file_type,
            1 - (atd.embedding_vector <=> $1::vector) as similarity
          FROM agent_training_data atd
          LEFT JOIN knowledge_sources ks ON atd.file_url = ks.file_url
          WHERE atd.agent_id = $2
        `;

        const params = [embeddingVector, dbAgentId];
        let paramIndex = 3;

        // Filter by document types if specified
        if (documentTypes.length > 0) {
          sqlQuery += ` AND atd.source_type = ANY($${paramIndex}::source_type[])`;
          params.push(documentTypes);
          paramIndex++;
        }

        // Filter by similarity threshold
        sqlQuery += ` AND (1 - (atd.embedding_vector <=> $1::vector)) >= $${paramIndex}`;
        params.push(threshold);
        paramIndex++;

        // Order by similarity and limit
        sqlQuery += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
        params.push(limit);

        result = await this.db.query(sqlQuery, params);
      } else {
        // Fallback: Fetch all embeddings and calculate similarity in-memory
        console.log(
          "pgvector not available - using in-memory similarity calculation"
        );

        let sqlQuery = `
          SELECT 
            atd.id,
            atd.title,
            atd.content,
            atd.source_type,
            atd.file_url,
            atd.created_at,
            atd.embedding_vector,
            ks.title as document_name,
            ks.file_type
          FROM agent_training_data atd
          LEFT JOIN knowledge_sources ks ON atd.file_url = ks.file_url
          WHERE atd.agent_id = $1
        `;

        const params = [dbAgentId];

        // Filter by document types if specified
        if (documentTypes.length > 0) {
          sqlQuery += ` AND atd.source_type = ANY($2::source_type[])`;
          params.push(documentTypes);
        }

        const allChunks = await this.db.query(sqlQuery, params);

        // Calculate similarity for each chunk
        const chunksWithSimilarity = allChunks.rows
          .map((row) => {
            try {
              // Parse JSON embedding
              const storedEmbedding = JSON.parse(row.embedding_vector);
              const similarity = this.calculateCosineSimilarity(
                queryEmbedding,
                storedEmbedding
              );

              return {
                ...row,
                similarity,
              };
            } catch (error) {
              console.error(
                `Error parsing embedding for chunk ${row.id}:`,
                error
              );
              return null;
            }
          })
          .filter((chunk) => chunk !== null && chunk.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        result = { rows: chunksWithSimilarity };
      }

      const results = result.rows.map((row) => ({
        score: parseFloat(row.similarity),
        documentId: row.id,
        chunkId: row.id,
        chunk: row.content,
        metadata: {
          title: row.title,
          sourceType: row.source_type,
          fileUrl: row.file_url,
          createdAt: row.created_at,
        },
        document: includeContent
          ? {
              name: row.document_name,
              type: row.file_type,
              format: row.file_type,
              uploadedAt: row.created_at,
            }
          : undefined,
      }));

      // ✅ COMPREHENSIVE LOGGING: Show retrieval results
      console.log("\n========== RAG RETRIEVAL RESULTS ==========");
      console.log(`Matches Found: ${results.length}`);
      if (results.length > 0) {
        console.log(
          `Similarity Scores:`,
          results.map((r) => r.score.toFixed(4))
        );
        console.log(
          `Top Match Preview:`,
          results[0].chunk.substring(0, 200) + "..."
        );
        console.log(`Document Names:`, [
          ...new Set(results.map((r) => r.document?.name).filter(Boolean)),
        ]);
      } else {
        console.warn(
          `⚠️ WARNING: No chunks found for agent ${agentId} (DB ID: ${dbAgentId})`
        );
        console.warn(`This means either:`);
        console.warn(`  1. No documents uploaded for this agent`);
        console.warn(
          `  2. Query embedding doesn't match stored embeddings (threshold too high)`
        );
        console.warn(`  3. Agent ID mismatch between upload and retrieval`);
      }
      console.log("==========================================\n");

      console.log(`Found ${results.length} relevant chunks for query`);
      return results;
    } catch (error) {
      console.error("Knowledge base search error:", error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  /**
   * Get agent's knowledge base documents
   * @param {string} agentId - Agent ID (UUID or integer)
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} List of documents with pagination
   */
  async getAgentDocuments(agentId, filters = {}) {
    try {
      const dbAgentId = await this.db.getAgentId(agentId);
      if (!dbAgentId) {
        console.log(
          `Agent ${agentId} not found - returning empty document list`
        );
        return {
          documents: [],
          pagination: { total: 0, offset: 0, limit: 20, hasMore: false },
        };
      }

      let sqlQuery = `
        SELECT 
          ks.id,
          ks.title,
          ks.file_url,
          ks.file_type,
          ks.size_mb,
          ks.processed,
          ks.created_at,
          COUNT(atd.id) as chunks_count
        FROM knowledge_sources ks
        LEFT JOIN agent_training_data atd ON ks.file_url = atd.file_url AND atd.agent_id = $1
        WHERE ks.agent_id = $1
      `;

      const params = [dbAgentId];
      let paramIndex = 2;

      // Apply filters
      if (filters.type) {
        sqlQuery += ` AND ks.file_type = $${paramIndex}::source_type`;
        params.push(filters.type);
        paramIndex++;
      }

      if (filters.search) {
        sqlQuery += ` AND ks.title ILIKE $${paramIndex}`;
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      sqlQuery += ` GROUP BY ks.id ORDER BY ks.created_at DESC`;

      // Get total count
      const countQuery = `
        SELECT COUNT(DISTINCT ks.id) as total
        FROM knowledge_sources ks
        WHERE ks.agent_id = $1
        ${filters.type ? ` AND ks.file_type = $2::source_type` : ""}
        ${filters.search ? ` AND ks.title ILIKE $${filters.type ? 3 : 2}` : ""}
      `;
      const countParams = params.slice(0, paramIndex - 1);
      const countResult = await this.db.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0]?.total || 0);

      // Apply pagination
      const offset = parseInt(filters.offset) || 0;
      const limit = parseInt(filters.limit) || 20;

      sqlQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await this.db.query(sqlQuery, params);

      return {
        documents: result.rows.map((row) => ({
          id: row.id,
          name: row.title,
          type: row.file_type,
          format: row.file_type,
          s3Url: row.file_url,
          chunksCount: parseInt(row.chunks_count),
          contentLength: 0, // Not stored separately
          uploadedAt: row.created_at,
          fileSize: Math.round(row.size_mb * 1024 * 1024), // Convert MB to bytes
        })),
        pagination: {
          total,
          offset,
          limit,
          hasMore: offset + limit < total,
        },
      };
    } catch (error) {
      console.error("Get agent documents error:", error);
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  /**
   * Delete document from knowledge base
   * @param {string} agentId - Agent ID (UUID or integer)
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteDocument(agentId, documentId) {
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");

      const dbAgentId = await this.db.getAgentId(agentId);
      if (!dbAgentId) {
        throw new Error(
          `Agent not found: ${agentId}. Cannot delete documents for non-existent agent.`
        );
      }

      // Get document info
      const docResult = await client.query(
        "SELECT file_url FROM knowledge_sources WHERE id = $1 AND agent_id = $2",
        [documentId, dbAgentId]
      );

      if (docResult.rows.length === 0) {
        throw new Error("Document not found");
      }

      const fileUrl = docResult.rows[0].file_url;

      // Extract S3 key from URL
      const s3Key = fileUrl.split(".amazonaws.com/")[1];

      // Delete from S3
      if (s3Key) {
        await s3Service.deleteImage(s3Key);
      }

      // Delete training data associated with this file and agent
      await client.query(
        "DELETE FROM agent_training_data WHERE file_url = $1 AND agent_id = $2",
        [fileUrl, dbAgentId]
      );

      // Delete knowledge source
      await client.query(
        "DELETE FROM knowledge_sources WHERE id = $1 AND agent_id = $2",
        [documentId, dbAgentId]
      );

      await client.query("COMMIT");

      console.log(`Deleted document ${documentId} for agent ${agentId}`);
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Delete document error:", error);
      throw new Error(`Failed to delete document: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Similarity score (0 to 1)
   */
  calculateCosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Generate query embedding using OpenAI
   * @param {string} query - Search query
   * @returns {Promise<Array>} Query embedding
   */
  async generateQueryEmbedding(query) {
    if (!this.openai) {
      // Fallback to mock embedding if OpenAI not configured
      console.warn(
        "Using MOCK query embedding - search results will be random"
      );
      return Array(1536)
        .fill(0)
        .map(() => Math.random());
    }

    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
        encoding_format: "float",
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating query embedding:", error.message);
      // Fallback to mock if API fails
      return Array(1536)
        .fill(0)
        .map(() => Math.random());
    }
  }

  /**
   * Get knowledge base statistics for agent
   * @param {string} agentId - Agent ID (UUID or integer)
   * @returns {Promise<Object>} Statistics
   */
  async getAgentStats(agentId) {
    try {
      const dbAgentId = await this.db.getAgentId(agentId);
      if (!dbAgentId) {
        return {
          totalDocuments: 0,
          totalChunks: 0,
          documentTypes: {},
          totalSize: 0,
        };
      }

      const result = await this.db.query(
        `
        SELECT 
          COUNT(DISTINCT ks.id) as total_documents,
          COUNT(atd.id) as total_chunks,
          COALESCE(SUM(ks.size_mb), 0) as total_size_mb,
          json_object_agg(
            COALESCE(ks.file_type::text, 'unknown'), 
            COUNT(DISTINCT ks.id)
          ) FILTER (WHERE ks.file_type IS NOT NULL) as document_types
        FROM knowledge_sources ks
        LEFT JOIN agent_training_data atd ON ks.file_url = atd.file_url AND atd.agent_id = $1
        WHERE ks.agent_id = $1
        `,
        [dbAgentId]
      );

      const row = result.rows[0];

      return {
        totalDocuments: parseInt(row.total_documents) || 0,
        totalChunks: parseInt(row.total_chunks) || 0,
        documentTypes: row.document_types || {},
        totalSize: Math.round(parseFloat(row.total_size_mb || 0) * 1024 * 1024), // Convert to bytes
      };
    } catch (error) {
      console.error("Get agent stats error:", error);
      return {
        totalDocuments: 0,
        totalChunks: 0,
        documentTypes: {},
        totalSize: 0,
      };
    }
  }
}

module.exports = new KnowledgeBaseService();
