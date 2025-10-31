const AWS = require("aws-sdk");
const path = require("path");

class S3Service {
  constructor() {
    // Ensure credentials are properly configured
    if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
      throw new Error("S3 credentials not found in environment variables");
    }

    this.s3 = new AWS.S3({
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT_URL,
      s3ForcePathStyle: true, // Required for custom S3 endpoints
      signatureVersion: "v4",
    });

    this.bucketName = process.env.S3_BUCKET_NAME;
    this.publicBaseUrl =
      process.env.S3_BUCKET_PUBLIC_URL ||
      `https://${this.bucketName}.s3.${process.env.S3_REGION}.amazonaws.com`;
  }

  /**
   * Get folder name based on file type
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Original filename
   * @returns {string} Folder name
   */
  getFolderByType(mimetype, filename) {
    const extension = filename.toLowerCase().split(".").pop();

    // Document types (PDF, DOCX, DOC, TXT)
    if (
      mimetype.includes("pdf") ||
      mimetype.includes("document") ||
      mimetype.includes("text") ||
      ["pdf", "docx", "doc", "txt"].includes(extension)
    ) {
      return "docs";
    }

    // Audio types (MP3, WAV, etc.)
    if (
      mimetype.includes("audio") ||
      ["mp3", "wav", "flac", "m4a"].includes(extension)
    ) {
      return "audio";
    }

    // Video types (MP4, AVI, etc.)
    if (
      mimetype.includes("video") ||
      ["mp4", "avi", "mov", "mkv", "webm"].includes(extension)
    ) {
      return "video";
    }

    // Default to docs for unknown types
    return "docs";
  }

  /**
   * Generate S3 key with user and type folder structure
   * @param {string} userId - User ID
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Original filename
   * @returns {string} S3 key
   */
  generateFileKey(userId, mimetype, filename) {
    const folderType = this.getFolderByType(mimetype, filename);
    const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${userId}/${folderType}/${cleanFilename}`;
  }

  /**
   * Upload file to S3 with user and type-specific folder structure
   * @param {string} userId - User ID
   * @param {Object} file - File object with buffer, originalname, mimetype
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(userId, file) {
    const key = this.generateFileKey(userId, file.mimetype, file.originalname);
    const folderType = this.getFolderByType(file.mimetype, file.originalname);

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        userId: userId,
        originalName: file.originalname,
        folderType: folderType,
        uploadDate: new Date().toISOString(),
      },
    };

    try {
      const result = await this.s3.upload(params).promise();

      return {
        location: result.Location,
        key: result.Key,
        bucket: result.Bucket,
        userId: userId,
        originalName: file.originalname,
        folderType: folderType,
        publicUrl: `${this.publicBaseUrl}/${result.Key}`,
      };
    } catch (error) {
      console.error("S3 upload error:", error);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Upload document buffer to S3 for knowledge base
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} userId - User ID
   * @param {string} originalName - Original filename
   * @param {string} mimetype - File MIME type
   * @returns {Promise<Object>} Upload result
   */
  async uploadDocument(fileBuffer, userId, originalName, mimetype) {
    const key = this.generateFileKey(userId, mimetype, originalName);
    const folderType = this.getFolderByType(mimetype, originalName);

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimetype,
      Metadata: {
        userId: userId,
        originalName: originalName,
        folderType: folderType,
        uploadDate: new Date().toISOString(),
      },
    };

    try {
      const result = await this.s3.upload(params).promise();

      return {
        location: result.Location,
        key: result.Key,
        bucket: result.Bucket,
        userId: userId,
        originalName: originalName,
        folderType: folderType,
        publicUrl: `${this.publicBaseUrl}/${result.Key}`,
      };
    } catch (error) {
      console.error("S3 upload document error:", error);
      throw new Error(`Failed to upload document to S3: ${error.message}`);
    }
  }

  /**
   * List files for a specific user and optional type
   * @param {string} userId - User ID
   * @param {string} folderType - Optional folder type (docs, audio, video)
   * @returns {Promise<Array>} List of user files
   */
  async listUserFiles(userId, folderType = null) {
    const prefix = folderType ? `${userId}/${folderType}/` : `${userId}/`;

    const params = {
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
    };

    try {
      const result = await this.s3.listObjectsV2(params).promise();

      return result.Contents.map((file) => {
        const pathParts = file.Key.split("/");
        const filename = pathParts[pathParts.length - 1];
        const type = pathParts.length > 2 ? pathParts[1] : "unknown";

        return {
          key: file.Key,
          filename: filename,
          type: type,
          size: file.Size,
          lastModified: file.LastModified,
          storageClass: file.StorageClass,
        };
      });
    } catch (error) {
      console.error("S3 list error:", error);
      throw new Error(
        `Failed to list files for user ${userId}: ${error.message}`
      );
    }
  }

  /**
   * Get all user folders (user IDs) in S3
   * @returns {Promise<Array>} List of user IDs
   */
  async listAllUsers() {
    const params = {
      Bucket: this.bucketName,
      Delimiter: "/",
      MaxKeys: 1000,
    };

    try {
      const result = await this.s3.listObjectsV2(params).promise();

      return (result.CommonPrefixes || []).map((prefix) =>
        prefix.Prefix.replace("/", "")
      );
    } catch (error) {
      console.error("S3 list users error:", error);
      throw new Error(`Failed to list users: ${error.message}`);
    }
  }

  /**
   * Get file from S3
   * @param {string} userId - User ID
   * @param {string} filename - Filename or full key
   * @returns {Promise<Object>} File data
   */
  async getFile(userId, filename) {
    // If filename contains userId path, use as-is, otherwise construct path
    const key = filename.includes("/") ? filename : `${userId}/${filename}`;

    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    try {
      const result = await this.s3.getObject(params).promise();

      return {
        body: result.Body,
        contentType: result.ContentType,
        metadata: result.Metadata,
      };
    } catch (error) {
      console.error("S3 get file error:", error);
      throw new Error(`Failed to get file ${key}: ${error.message}`);
    }
  }

  /**
   * Delete file from S3
   * @param {string} userId - User ID
   * @param {string} filename - Filename or full key
   * @returns {Promise<void>}
   */
  async deleteFile(userId, filename) {
    const key = filename.includes("/") ? filename : `${userId}/${filename}`;

    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    try {
      await this.s3.deleteObject(params).promise();
      console.log(`✅ Deleted file: ${key}`);
    } catch (error) {
      console.error("S3 delete error:", error);
      throw new Error(`Failed to delete file ${key}: ${error.message}`);
    }
  }

  /**
   * Delete file from S3 using full key
   * @param {string} key - Full S3 key path
   * @returns {Promise<void>}
   */
  async deleteImage(key) {
    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    try {
      await this.s3.deleteObject(params).promise();
      console.log(`✅ Deleted file: ${key}`);
    } catch (error) {
      console.error("S3 delete error:", error);
      throw new Error(`Failed to delete file ${key}: ${error.message}`);
    }
  }
}

module.exports = new S3Service();
