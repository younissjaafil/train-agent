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
   * @param {string|number} agentId - Agent ID (integer)
   * @returns {Promise<number|null>} Database agent ID or null
   */
  async getAgentId(agentId) {
    try {
      const result = await this.query(
        "SELECT id FROM agents WHERE id = $1::int",
        [agentId]
      );
      return result.rows.length > 0 ? result.rows[0].id : null;
    } catch (error) {
      console.error("Error getting agent ID:", error);
      return null;
    }
  }
}

module.exports = new DatabaseService();
