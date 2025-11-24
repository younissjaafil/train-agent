const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const axios = require("axios");
const OpenAI = require("openai");
// const cheerio = require("cheerio"); // Commented out for now, will use text parsing
const { URL } = require("url");

class DocumentProcessorService {
  constructor() {
    // Initialize OpenAI client
    this.openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

    if (!this.openai) {
      console.warn(
        "⚠️  OpenAI API key not found - using MOCK embeddings (not production-ready)"
      );
    } else {
      console.log("✅ OpenAI embeddings enabled");
    }

    this.supportedTypes = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      txt: "text/plain",
      md: "text/markdown",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      mp4: "video/mp4",
      avi: "video/avi",
      url: "text/html", // Add URL support
    };

    // Maximum file size: 50MB
    this.MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
  }

  /**
   * Validate file size
   * @param {Buffer} buffer - File buffer
   * @throws {Error} If file is too large or empty
   */
  validateFileSize(buffer) {
    if (!buffer || buffer.length === 0) {
      throw new Error("File is empty");
    }

    if (buffer.length > this.MAX_FILE_SIZE) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
      throw new Error(`File size (${sizeMB}MB) exceeds maximum limit of 50MB`);
    }

    return true;
  }

  /**
   * Check if file type is supported
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Original filename
   * @returns {boolean} Whether file is supported
   */
  isSupported(mimetype, filename) {
    const extension = path.extname(filename).toLowerCase().slice(1);

    // Check if it's a URL
    if (this.isValidUrl(filename)) {
      return true;
    }

    return (
      Object.keys(this.supportedTypes).includes(extension) ||
      Object.values(this.supportedTypes).includes(mimetype)
    );
  }

  /**
   * Check if string is a valid URL
   * @param {string} string - String to check
   * @returns {boolean} Whether string is a valid URL
   */
  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Extract text content from various file types
   * @param {Buffer} buffer - File buffer
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Original filename
   * @returns {Promise<Object>} Extracted content and metadata
   */
  async extractContent(buffer, mimetype, filename) {
    // Handle URLs
    if (this.isValidUrl(filename)) {
      return await this.extractFromUrl(filename);
    }

    // Validate file size for non-URL files
    this.validateFileSize(buffer);

    const extension = path.extname(filename).toLowerCase().slice(1);

    try {
      switch (extension) {
        case "pdf":
          return await this.extractFromPDF(buffer);
        case "doc":
        case "docx":
          return await this.extractFromWord(buffer);
        case "txt":
        case "md":
          return await this.extractFromText(buffer);
        case "mp3":
        case "wav":
          return await this.extractFromAudio(buffer, filename);
        case "mp4":
        case "avi":
          return await this.extractFromVideo(buffer, filename);
        default:
          throw new Error(`Unsupported file type: ${extension}`);
      }
    } catch (error) {
      console.error("Content extraction error:", error);
      throw new Error(
        `Failed to extract content from ${extension}: ${error.message}`
      );
    }
  }

  /**
   * Extract content from a URL
   * @param {string} url - The URL to scrape
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromUrl(url) {
    try {
      console.log(`Scraping URL: ${url}`);

      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        maxRedirects: 5,
      });

      const htmlContent = response.data;

      // Basic HTML content extraction without cheerio
      const extractedContent = this.extractTextFromHtml(htmlContent);

      // Get page title from HTML
      const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

      // Get meta description
      const descMatch = htmlContent.match(
        /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i
      );
      const description = descMatch ? descMatch[1].trim() : "";

      return {
        content: extractedContent,
        metadata: {
          url: url,
          title: title,
          description: description,
          contentType: response.headers["content-type"] || "text/html",
          statusCode: response.status,
          wordCount: extractedContent
            .split(/\s+/)
            .filter((word) => word.length > 0).length,
          characterCount: extractedContent.length,
          scrapedAt: new Date().toISOString(),
          domain: new URL(url).hostname,
        },
        type: "webpage",
        format: "html",
      };
    } catch (error) {
      console.error(`Error scraping URL ${url}:`, error.message);
      throw new Error(`Failed to scrape URL: ${error.message}`);
    }
  }

  /**
   * Extract text content from HTML string (basic implementation without cheerio)
   * @param {string} html - HTML content
   * @returns {string} Extracted text
   */
  extractTextFromHtml(html) {
    // Remove script and style elements
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");

    // Clean up whitespace
    text = text.replace(/\s+/g, " ");
    text = text.trim();

    return text;
  }

  /**
   * Extract text from PDF
   * @param {Buffer} buffer - PDF buffer
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromPDF(buffer) {
    const data = await pdfParse(buffer);

    return {
      content: data.text,
      metadata: {
        pages: data.numpages,
        info: data.info,
        wordCount: data.text.split(/\s+/).length,
        characterCount: data.text.length,
      },
      type: "document",
      format: "pdf",
    };
  }

  /**
   * Extract text from Word documents
   * @param {Buffer} buffer - Word document buffer
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromWord(buffer) {
    const result = await mammoth.extractRawText({ buffer });

    return {
      content: result.value,
      metadata: {
        wordCount: result.value.split(/\s+/).length,
        characterCount: result.value.length,
        messages: result.messages,
      },
      type: "document",
      format: "word",
    };
  }

  /**
   * Extract text from plain text files
   * @param {Buffer} buffer - Text file buffer
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromText(buffer) {
    const content = buffer.toString("utf8");

    return {
      content,
      metadata: {
        wordCount: content.split(/\s+/).length,
        characterCount: content.length,
        lineCount: content.split("\n").length,
      },
      type: "document",
      format: "text",
    };
  }

  /**
   * Process audio files (placeholder for speech-to-text)
   * @param {Buffer} buffer - Audio buffer
   * @param {string} filename - Original filename
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromAudio(buffer, filename) {
    // For now, return placeholder - in production, integrate with speech-to-text service
    const audioInfo = this.getAudioInfo(buffer);

    return {
      content: `[Audio file: ${filename}] - Content will be transcribed using speech-to-text service`,
      metadata: {
        duration: audioInfo.duration || "unknown",
        size: buffer.length,
        needsTranscription: true,
      },
      type: "audio",
      format: path.extname(filename).toLowerCase().slice(1),
    };
  }

  /**
   * Process video files (placeholder for speech-to-text from audio track)
   * @param {Buffer} buffer - Video buffer
   * @param {string} filename - Original filename
   * @returns {Promise<Object>} Extracted content
   */
  async extractFromVideo(buffer, filename) {
    // For now, return placeholder - in production, extract audio and transcribe
    const videoInfo = this.getVideoInfo(buffer);

    return {
      content: `[Video file: ${filename}] - Audio track will be extracted and transcribed`,
      metadata: {
        duration: videoInfo.duration || "unknown",
        size: buffer.length,
        needsTranscription: true,
        needsAudioExtraction: true,
      },
      type: "video",
      format: path.extname(filename).toLowerCase().slice(1),
    };
  }

  /**
   * Get basic audio file information
   * @param {Buffer} buffer - Audio buffer
   * @returns {Object} Audio metadata
   */
  getAudioInfo(buffer) {
    // Basic audio info extraction - in production, use proper audio analysis library
    return {
      size: buffer.length,
      type: "audio",
    };
  }

  /**
   * Get basic video file information
   * @param {Buffer} buffer - Video buffer
   * @returns {Object} Video metadata
   */
  getVideoInfo(buffer) {
    // Basic video info extraction - in production, use proper video analysis library
    return {
      size: buffer.length,
      type: "video",
    };
  }

  /**
   * Create chunks for RAG processing
   * @param {string} content - Extracted text content
   * @param {Object} options - Chunking options
   * @returns {Array} Array of text chunks
   */
  createChunks(content, options = {}) {
    const {
      chunkSize = 1000,
      overlap = 200,
      separators = ["\n\n", "\n", ". ", "! ", "? ", "; ", " "],
    } = options;

    if (content.length <= chunkSize) {
      return [content];
    }

    const chunks = [];
    let start = 0;

    while (start < content.length) {
      let end = Math.min(start + chunkSize, content.length);

      // Try to break at a natural separator
      if (end < content.length) {
        let bestBreak = end;
        for (const separator of separators) {
          const lastIndex = content.lastIndexOf(separator, end);
          if (lastIndex > start + chunkSize * 0.5) {
            bestBreak = lastIndex + separator.length;
            break;
          }
        }
        end = bestBreak;
      }

      const chunk = content.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Fix: Ensure we always move forward to prevent infinite loop
      const nextStart = Math.max(start + 1, end - overlap);
      if (nextStart <= start) {
        start = end; // Force progression if overlap is too large
      } else {
        start = nextStart;
      }

      // Safety check to prevent infinite loops
      if (chunks.length > 1000) {
        console.warn("Chunking stopped: too many chunks generated");
        break;
      }
    }

    return chunks;
  }

  /**
   * Generate embeddings for text chunks using OpenAI
   * @param {Array} chunks - Text chunks
   * @returns {Promise<Array>} Array of embeddings
   */
  async generateEmbeddings(chunks) {
    if (!this.openai) {
      // Fallback to mock embeddings if OpenAI not configured
      console.warn(
        "Using MOCK embeddings - results will not be semantically accurate"
      );
      return chunks.map((chunk, index) => ({
        chunkIndex: index,
        chunk,
        embedding: Array(1536)
          .fill(0)
          .map(() => Math.random()), // Mock embedding
        metadata: {
          length: chunk.length,
          wordCount: chunk.split(/\s+/).length,
        },
      }));
    }

    // Process in batches to respect rate limits (max 3000 requests/min for tier 1)
    const batchSize = 100;
    const results = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      try {
        // Call OpenAI embeddings API
        const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small", // Cheaper & faster than ada-002
          input: batch,
          encoding_format: "float",
        });

        // Map embeddings to chunks
        batch.forEach((chunk, idx) => {
          results.push({
            chunkIndex: i + idx,
            chunk,
            embedding: response.data[idx].embedding,
            metadata: {
              length: chunk.length,
              wordCount: chunk.split(/\s+/).length,
              model: "text-embedding-3-small",
              dimensions: response.data[idx].embedding.length,
            },
          });
        });

        // Add delay between batches to avoid rate limits
        if (i + batchSize < chunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(
          `Error generating embeddings for batch ${i}:`,
          error.message
        );

        // If API fails, fall back to mock for this batch
        batch.forEach((chunk, idx) => {
          results.push({
            chunkIndex: i + idx,
            chunk,
            embedding: Array(1536)
              .fill(0)
              .map(() => Math.random()),
            metadata: {
              length: chunk.length,
              wordCount: chunk.split(/\s+/).length,
              error: "OpenAI API call failed - using mock embedding",
            },
          });
        });
      }
    }

    return results;
  }

  /**
   * Process document for RAG (including URLs)
   * @param {Buffer|string} buffer - File buffer or URL string
   * @param {string} mimetype - File MIME type
   * @param {string} filename - Original filename or URL
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed document with embeddings
   */
  async processForRAG(buffer, mimetype, filename, options = {}) {
    let extracted;

    // Handle URL processing
    if (this.isValidUrl(filename)) {
      extracted = await this.extractFromUrl(filename);
    } else {
      // Extract content from file
      extracted = await this.extractContent(buffer, mimetype, filename);
    }

    // Create chunks
    const chunks = this.createChunks(extracted.content, options.chunking);

    // Generate embeddings
    const embeddings = await this.generateEmbeddings(chunks);

    return {
      ...extracted,
      chunks,
      embeddings,
      ragMetadata: {
        totalChunks: chunks.length,
        processedAt: new Date().toISOString(),
        options: options.chunking,
      },
    };
  }

  /**
   * Process multiple URLs for RAG
   * @param {Array<string>} urls - Array of URLs to process
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} Array of processed documents with embeddings
   */
  async processUrlsForRAG(urls, options = {}) {
    const results = [];

    for (const url of urls) {
      try {
        const processed = await this.processForRAG(null, null, url, options);
        results.push(processed);

        // Add delay between requests
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to process URL for RAG ${url}:`, error.message);
        results.push({
          content: `Failed to process URL: ${url}`,
          metadata: { url, error: error.message },
          type: "webpage",
          format: "error",
          chunks: [],
          embeddings: [],
        });
      }
    }

    return results;
  }

  /**
   * Process URLs from a file containing a list of URLs
   * @param {string} filePath - Path to file containing URLs
   * @returns {Promise<Array>} Array of processed URL content
   */
  async processUrlsFromFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const urls = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && this.isValidUrl(line));

      console.log(`Found ${urls.length} valid URLs to process`);

      const results = [];

      for (const url of urls) {
        try {
          const extracted = await this.extractFromUrl(url);
          results.push(extracted);

          // Add a small delay between requests to be respectful
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to process URL ${url}:`, error.message);
          results.push({
            content: `Failed to scrape URL: ${url}. Error: ${error.message}`,
            metadata: {
              url: url,
              error: error.message,
              scrapedAt: new Date().toISOString(),
            },
            type: "webpage",
            format: "error",
          });
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to process URLs from file: ${error.message}`);
    }
  }
}

module.exports = new DocumentProcessorService();
