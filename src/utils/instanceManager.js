/**
 * Utility for managing AI instances and user data
 * This module provides functions to interact with user instances
 * and manage the relationship between users and their AI sessions
 */

class InstanceManager {
  constructor() {
    // In a real implementation, this would connect to your database
    // For now, we'll use in-memory storage as a placeholder
    this.instances = new Map();
    this.userSessions = new Map();
  }

  /**
   * Get user instance information
   * @param {string} userId - User ID from 3VO
   * @returns {Promise<Object>} User instance data
   */
  async getUserInstance(userId) {
    try {
      // In a real implementation, this would query your database
      // For now, return mock data based on the pattern you described
      const instance = this.instances.get(userId) || {
        userId,
        aiId: `ai_${userId}`,
        assistantId: `asst_${userId}`,
        status: "active",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        settings: {
          model: "gpt-4-vision-preview",
          temperature: 0.7,
          maxTokens: 1500,
          language: "en",
        },
        permissions: {
          uploadImages: true,
          processS2: true,
          processS3: true,
          generateContent: true,
        },
      };

      this.instances.set(userId, instance);
      return instance;
    } catch (error) {
      console.error("Get user instance error:", error);
      throw new Error(`Failed to get user instance: ${error.message}`);
    }
  }

  /**
   * Create new user instance
   * @param {string} userId - User ID from 3VO
   * @param {Object} options - Instance configuration options
   * @returns {Promise<Object>} Created instance data
   */
  async createUserInstance(userId, options = {}) {
    try {
      const instance = {
        userId,
        aiId: `ai_${userId}_${Date.now()}`,
        assistantId: `asst_${userId}_${Date.now()}`,
        status: "active",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        settings: {
          model: options.model || "gpt-4-vision-preview",
          temperature: options.temperature || 0.7,
          maxTokens: options.maxTokens || 1500,
          language: options.language || "en",
          ...options.settings,
        },
        permissions: {
          uploadImages: true,
          processS2: true,
          processS3: true,
          generateContent: true,
          ...options.permissions,
        },
      };

      this.instances.set(userId, instance);

      console.log(`Created new instance for user: ${userId}`);
      return instance;
    } catch (error) {
      console.error("Create user instance error:", error);
      throw new Error(`Failed to create user instance: ${error.message}`);
    }
  }

  /**
   * Update user instance settings
   * @param {string} userId - User ID
   * @param {Object} updates - Settings to update
   * @returns {Promise<Object>} Updated instance data
   */
  async updateUserInstance(userId, updates) {
    try {
      const instance = await this.getUserInstance(userId);

      // Update the instance
      const updatedInstance = {
        ...instance,
        ...updates,
        lastActiveAt: new Date().toISOString(),
      };

      this.instances.set(userId, updatedInstance);

      console.log(`Updated instance for user: ${userId}`);
      return updatedInstance;
    } catch (error) {
      console.error("Update user instance error:", error);
      throw new Error(`Failed to update user instance: ${error.message}`);
    }
  }

  /**
   * Get user's teaching sessions
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} List of sessions
   */
  async getUserSessions(userId, filters = {}) {
    try {
      const userSessions = this.userSessions.get(userId) || [];

      let filteredSessions = [...userSessions];

      // Apply filters
      if (filters.type) {
        filteredSessions = filteredSessions.filter(
          (session) => session.type === filters.type
        );
      }

      if (filters.startDate) {
        filteredSessions = filteredSessions.filter(
          (session) =>
            new Date(session.createdAt) >= new Date(filters.startDate)
        );
      }

      if (filters.endDate) {
        filteredSessions = filteredSessions.filter(
          (session) => new Date(session.createdAt) <= new Date(filters.endDate)
        );
      }

      // Apply sorting
      const sortBy = filters.sortBy || "createdAt";
      const sortOrder = filters.sortOrder || "desc";

      filteredSessions.sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];

        if (sortOrder === "desc") {
          return aVal > bVal ? -1 : 1;
        } else {
          return aVal > bVal ? 1 : -1;
        }
      });

      // Apply pagination
      const offset = parseInt(filters.offset) || 0;
      const limit = parseInt(filters.limit) || 20;

      const paginatedSessions = filteredSessions.slice(offset, offset + limit);

      return {
        sessions: paginatedSessions,
        total: filteredSessions.length,
        pagination: {
          offset,
          limit,
          hasMore: offset + limit < filteredSessions.length,
        },
      };
    } catch (error) {
      console.error("Get user sessions error:", error);
      throw new Error(`Failed to get user sessions: ${error.message}`);
    }
  }

  /**
   * Save teaching session
   * @param {Object} sessionData - Session data to save
   * @returns {Promise<Object>} Saved session with ID
   */
  async saveSession(sessionData) {
    try {
      const sessionId = `session_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const session = {
        id: sessionId,
        ...sessionData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Get user's sessions
      const userSessions = this.userSessions.get(sessionData.userId) || [];
      userSessions.push(session);

      // Update user's sessions
      this.userSessions.set(sessionData.userId, userSessions);

      // Update user's last active time
      await this.updateUserInstance(sessionData.userId, {
        lastActiveAt: new Date().toISOString(),
      });

      console.log(`Saved session ${sessionId} for user: ${sessionData.userId}`);
      return session;
    } catch (error) {
      console.error("Save session error:", error);
      throw new Error(`Failed to save session: ${error.message}`);
    }
  }

  /**
   * Get session by ID
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async getSession(userId, sessionId) {
    try {
      const userSessions = this.userSessions.get(userId) || [];
      return userSessions.find((session) => session.id === sessionId) || null;
    } catch (error) {
      console.error("Get session error:", error);
      throw new Error(`Failed to get session: ${error.message}`);
    }
  }

  /**
   * Delete session
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteSession(userId, sessionId) {
    try {
      const userSessions = this.userSessions.get(userId) || [];
      const filteredSessions = userSessions.filter(
        (session) => session.id !== sessionId
      );

      if (filteredSessions.length < userSessions.length) {
        this.userSessions.set(userId, filteredSessions);
        console.log(`Deleted session ${sessionId} for user: ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("Delete session error:", error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  /**
   * Get usage statistics for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Usage statistics
   */
  async getUserStats(userId) {
    try {
      const sessions = await this.getUserSessions(userId);
      const instance = await this.getUserInstance(userId);

      const stats = {
        totalSessions: sessions.total,
        s2Sessions: sessions.sessions.filter((s) => s.type === "s2").length,
        s3Sessions: sessions.sessions.filter((s) => s.type === "s3").length,
        totalImagesProcessed: sessions.sessions.length,
        lastActive: instance.lastActiveAt,
        accountCreated: instance.createdAt,
      };

      return stats;
    } catch (error) {
      console.error("Get user stats error:", error);
      throw new Error(`Failed to get user stats: ${error.message}`);
    }
  }
}

module.exports = new InstanceManager();
