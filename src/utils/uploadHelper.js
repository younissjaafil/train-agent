const multer = require("multer");
const path = require("path");

// Configure multer for memory storage (we'll process and upload to S3)
const storage = multer.memoryStorage();

// File filter to only allow images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|bmp/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(
      new Error("Only image files are allowed (jpeg, jpg, png, gif, webp, bmp)")
    );
  }
};

// File filter for documents (knowledge base)
const documentFileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|txt|md|mp3|wav|mp4|avi/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );

  const allowedMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "audio/mpeg",
    "audio/wav",
    "video/mp4",
    "video/avi",
  ];

  const mimetype = allowedMimeTypes.includes(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(
      new Error(
        "Only document files are allowed (PDF, DOC, DOCX, TXT, MD, MP3, WAV, MP4, AVI)"
      )
    );
  }
};

// Configure upload limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5, // Maximum 5 files per request
  },
  fileFilter: fileFilter,
});

// Configure document upload limits
const documentUpload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for documents
    files: 1, // Single file upload for knowledge base
  },
  fileFilter: documentFileFilter,
});

/**
 * Middleware for single file upload
 */
const uploadSingle = upload.single("image");

/**
 * Middleware for multiple file upload
 */
const uploadMultiple = upload.array("images", 5);

/**
 * Middleware for single document upload (knowledge base)
 */
const uploadDocument = documentUpload.single("file");

/**
 * Handle upload errors
 */
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File size too large. Maximum size is 50MB for documents.",
        code: "FILE_TOO_LARGE",
      });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        error: "Too many files. Maximum is 5 files.",
        code: "TOO_MANY_FILES",
      });
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        error:
          'Unexpected field name. Use "image" for single upload or "images" for multiple.',
        code: "UNEXPECTED_FIELD",
      });
    }
  }

  if (error.message.includes("Only image files are allowed")) {
    return res.status(400).json({
      success: false,
      error: error.message,
      code: "INVALID_FILE_TYPE",
    });
  }

  // Pass other errors to the next error handler
  next(error);
};

/**
 * Validate file before processing
 */
const validateFile = (file) => {
  if (!file) {
    throw new Error("No file provided");
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new Error("Empty file provided");
  }

  return true;
};

/**
 * Extract user ID from request
 */
const extractUserId = (req) => {
  // Try to get user ID from various sources (prioritize user_id with underscore)
  const userId =
    req.body.user_id ||
    req.body.userId ||
    req.query.user_id ||
    req.query.userId ||
    req.headers["x-user-id"] ||
    req.user?.id; // If using authentication middleware

  if (!userId) {
    throw new Error("User ID is required");
  }

  return userId;
};

/**
 * Validate request parameters
 */
const validateImageRequest = (req, type) => {
  const userId = extractUserId(req);

  if (!["s2", "s3"].includes(type)) {
    throw new Error('Invalid image type. Must be "s2" or "s3"');
  }

  return { userId, type };
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  uploadDocument,
  handleUploadError,
  validateFile,
  extractUserId,
  validateImageRequest,
};
