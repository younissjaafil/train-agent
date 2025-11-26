const { Pool } = require("pg");

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection pool
   */
  async initialize() {
    try {
      if (this.pool) {
        console.log("Database pool already initialized");
        return;
      }

      const connectionString = process.env.POSTGRES_DB;
      if (!connectionString) {
        throw new Error("POSTGRES_DB environment variable is not set");
      }

      this.pool = new Pool({
        connectionString,
        ssl: {
          rejectUnauthorized: false, // For Railway or other cloud databases
        },
        max: 20, // Maximum pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      const client = await this.pool.connect();
      console.log("✅ PostgreSQL database connected successfully");
      client.release();
      this.isConnected = true;
    } catch (error) {
      console.error("❌ Database connection error:", error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Get database client from pool
   * @returns {Promise<Object>} Database client
   */
  async getClient() {
    if (!this.pool) {
      await this.initialize();
    }
    return this.pool.connect();
  }

  /**
   * Execute a query
   * @param {string} text - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(text, params = []) {
    if (!this.pool) {
      await this.initialize();
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log(`Query executed in ${duration}ms:`, text.substring(0, 100));
      return result;
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log("Database connection closed");
    }
  }

  /**
   * Get user ID by user_id string
   * @param {string} userId - User ID string
   * @returns {Promise<number|null>} Database user ID or null
   */
  async getUserId(userId) {
    try {
      const result = await this.query(
        "SELECT id FROM users WHERE user_id = $1",
        [userId]
      );
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error("Error getting user ID:", error);
      return null;
    }
  }

  /**
   * Get or create user ID
   * @param {string} userId - User ID string
   * @param {Object} userData - Optional user data for creation
   * @returns {Promise<number>} Database user ID
   */
  async getOrCreateUserId(userId, userData = {}) {
    let dbUserId = await this.getUserId(userId);

    if (!dbUserId) {
      // Create user if doesn't exist
      const result = await this.query(
        `INSERT INTO users (user_id, name, email, password, role, campus) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING id`,
        [
          userId,
          userData.name || `User ${userId}`,
          userData.email || `${userId}@example.com`,
          userData.password || "temp_password",
          userData.role || "student",
          userData.campus || "default",
        ]
      );
      dbUserId = result.rows[0].id;
      console.log(
        `Created new user with ID ${dbUserId} for user_id: ${userId}`
      );
    }

    return dbUserId;
  }

  /**
   * Get agent ID by agent identifier
   * @param {string} agentIdentifier - Agent UUID or ID
   * @returns {Promise<number|null>} Database agent ID or null
   */
  async getAgentId(agentIdentifier) {
    try {
      // Check if it's a number first (try by integer ID)
      if (!isNaN(agentIdentifier)) {
        const result = await this.query(
          "SELECT id FROM agents WHERE id = $1::int",
          [agentIdentifier]
        );
        return result.rows.length > 0 ? result.rows[0].id : null;
      }

      // Try to query by UUID (training_api_uuid column in actual schema)
      const result = await this.query(
        "SELECT id FROM agents WHERE training_api_uuid = $1::uuid",
        [agentIdentifier]
      );

      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error("Error getting agent ID:", error);
      return null;
    }
  }

  /**
   * Get or create agent ID by agent identifier
   * Auto-registers agent if it doesn't exist
   * @param {string} agentIdentifier - Agent UUID (new agents) or ID (existing)
   * @param {Object} agentData - Optional agent data for creation (name, description, creatorUserId, etc.)
   * @returns {Promise<number>} Database agent ID
   */
  async getOrCreateAgentId(agentIdentifier, agentData = {}) {
    let dbAgentId = await this.getAgentId(agentIdentifier);

    if (!dbAgentId) {
      // Agent doesn't exist - auto-register it
      console.log(`Agent ${agentIdentifier} not found - auto-registering...`);

      // Get or create default creator user
      const creatorUserId = agentData.creatorUserId || "AUTO_REGISTERED";
      const creatorId = await this.getOrCreateUserId(creatorUserId, {
        name: agentData.creatorName || "Auto-registered Creator",
        email: agentData.creatorEmail || `${creatorUserId}@auto.generated`,
        password: "auto_generated",
        role: "instructor",
        campus: "default",
      });

      // Create new agent with only required fields from actual schema
      // Note: training_api_uuid needs to be explicitly set to the agentIdentifier
      const result = await this.query(
        `INSERT INTO agents (creator_id, name, description, training_api_uuid)
         VALUES ($1, $2, $3, $4::uuid)
         RETURNING id, training_api_uuid`,
        [
          creatorId,
          agentData.name || `Agent ${agentIdentifier.substring(0, 8)}`,
          agentData.description || "Auto-registered agent for training",
          agentIdentifier, // Use the provided UUID
        ]
      );

      dbAgentId = result.rows[0].id;

      // Try to initialize agent stats (if table exists)
      try {
        await this.query(
          `INSERT INTO agent_stats (agent_id, total_conversations, total_messages, avg_rating)
           VALUES ($1, 0, 0, 0.0)
           ON CONFLICT (agent_id) DO NOTHING`,
          [dbAgentId]
        );
      } catch (statsError) {
        console.log(
          `Note: Could not initialize agent_stats (table may not exist)`
        );
      }

      console.log(
        `✅ Auto-registered agent ${agentIdentifier} with DB ID ${dbAgentId}`
      );
    }

    return dbAgentId;
  }
}

module.exports = new DatabaseService();
