import express from 'express';
import os from 'os';
import fs from 'fs';
import cors from 'cors'
import { createClient } from 'redis';
import checkDiskSpace from 'check-disk-space';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

dotenv.config();


const redisClient = createClient({
    username:process.env.REDIS_USER_NAME ,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
    console.log('Redis connected successfully');
  } catch (err) {
    console.error('Error connecting to Redis:', err);
  }
})();


const prisma = new PrismaClient();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use(express.json());

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Folder to store uploaded files
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// Apply rate limiting globally (for all routes)
app.use(limiter);
app.use(cors());


const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
};

// Remove the promisify and use the native Promise-based methods
const fetchAndCache = async (modelName, identifier, redisKey, prismaQuery, res, next) => {
  try {
    // Check Redis for cached data
    const data = await redisClient.get(redisKey); // Directly await the promise
    
    if (data) {
      // If cached data is found, return it
      return res.json(JSON.parse(data));
    }

    // Query the database
    const result = await prisma[modelName][prismaQuery.method](prismaQuery.options);

    if (!result || (Array.isArray(result) && result.length === 0)) {
      return res.status(404).json({ error: `${modelName} not found` });
    }

    // Cache the result in Redis (TTL: 3600 seconds)
    await redisClient.setEx(redisKey, 3600, JSON.stringify(result)); // Using setEx for node-redis

    // Return the result
    res.json(result);
  } catch (err) {
    next(err);
  }
};




app.get('/health', async (req, res) => {
  try {
    // Run a simple query to check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Get memory information
    const freeMemory = os.freemem() / (1024 * 1024); // in MB
    const totalMemory = os.totalmem() / (1024 * 1024); // in MB

    // Get disk space information
    const diskSpace = await checkDiskSpace('C:/'); // specify the disk path (e.g., C:/)

    // Respond with health status and resource info
    res.status(200).json({
      status: 'healthy',
      memory: {
        freeMemory: freeMemory.toFixed(2) + ' MB',
        totalMemory: totalMemory.toFixed(2) + ' MB',
      },
      disk: {
        free: (diskSpace.free / (1024 * 1024)).toFixed(2) + ' MB', // Convert bytes to MB
        total: (diskSpace.total / (1024 * 1024)).toFixed(2) + ' MB', // Convert bytes to MB
      },
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message || 'Unexpected error',
    });
  }
});

// Search photo by ID with redis 
app.get("/v1/photos/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate that `id` is a non-empty string
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    const redisKey = `photos:id:${id}`;
    const prismaQuery = {
      method: "findUnique",
      options: { where: { id: String(id) } },  // Ensure the id is passed as a string
    };

    // Call the fetchAndCache function
    await fetchAndCache("photo", id, redisKey, prismaQuery, res, next);
  } catch (err) {
    // Log the error if something goes wrong
    console.error("Error fetching photo:", err);
    next(err); // Pass the error to the next middleware
  }
});


// Search photos by tag name
app.get("/v1/photos", async (req, res, next) => {
  try {
    const { tags } = req.query;  // Retrieve tags from query parameters

    // Validate that `tags` is a non-empty string
    if (!tags || typeof tags !== "string") {
      return res.status(400).json({ error: "Invalid tags" });
    }

    // Split the tags into an array and trim any spaces
    const tagList = tags.split(",").map(tag => tag.trim());

    const redisKey = `photos:tags:${tagList.join(",")}`; // Use tags to form the cache key
    const prismaQuery = {
      method: "findMany",  // Use `findMany` for multiple results
      options: {
        where: {
          tags: {
            hasSome: tagList,  // `hasSome` allows matching any of the provided tags
          },
        },
      },
    };

    // Call the fetchAndCache function to fetch and cache results
    await fetchAndCache("photo", tags, redisKey, prismaQuery, res, next);
  } catch (err) {
    // Log the error if something goes wrong
    console.error("Error fetching photos by tags:", err);
    next(err);  // Pass the error to the next middleware
  }
});

app.get('/v1/videos', async (req, res, next) => {
  try {
    // Fetch all videos from the database
    const videos = await prisma.video.findMany();

    // Respond with the full list of videos
    res.json({ videos, totalVideos: videos.length });
  } catch (err) {
    console.error('Error fetching all videos:', err);
    next(err); // Pass error to the next middleware
  }
});


    // Search photos by tag name
    app.post('/v1/photos/upload', upload.single('photo'), async (req, res, next) => {
      try {
        console.log('Request Body:', req.body);  // Log the request body
        console.log('Uploaded File:', req.file);  // Log the uploaded file
    
        const { tags, imageId } = req.body;
        const file = req.file;
    
        if (!file) {
          return res.status(400).json({ error: 'Photo file is required' });
        }
    
        if (!tags) {
          return res.status(400).json({ error: 'Tags are required' });
        }
    
        const photoCount = await prisma.photo.count();
        if (photoCount >= 50) {
          return res.status(400).json({ error: 'Photo storage limit reached (50)' });
        }
    
        if (imageId) {
          console.log('Received Image ID:', imageId); // Log the imageId
    
          const existingPhoto = await prisma.photo.findUnique({
            where: { id: imageId }
          });
    
          if (existingPhoto) {
            return res.status(400).json({ error: 'Photo ID already exists' });
          }
        }
    
        const newPhoto = await prisma.photo.create({
          data: {
            url: `/uploads/${file.filename}`, 
            tags: JSON.parse(tags),
            id: imageId ,  // Include ID if provided
          },
        });
        res.status(201).json(newPhoto);
      } catch (err) {
        console.error('Error uploading photo:', err); // Log the error
        next(err);  // Pass error to global error handler
      }
    });
    

// Search video by ID
app.delete('/v1/videos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate that the ID is a non-empty string
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid video ID' });
    }

    // Perform a soft delete by updating the deletedAt field
    const deletedVideo = await prisma.video.update({
      where: { id: String(id) }, // Ensure the ID is treated as a string
      data: { deletedAt: new Date() }, // Set the deletedAt timestamp
    });

    // Return the updated (soft-deleted) video record
    res.json({ message: 'Video deleted successfully', video: deletedVideo });
  } catch (err) {
    // Handle Prisma's "record not found" error (P2025)
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Log and pass other errors to the middleware
    console.error('Error deleting video:', err);
    next(err);
  }
});


    
// Search videos by tag name
app.get("/v1/videos", async (req, res, next) => {
  try {
    const { tags } = req.query; // Retrieve tags from query parameters

    // Log the received query parameters for debugging
    console.log("Received query parameters:", req.query);

    // Validate that `tags` is a non-empty string
    if (!tags) {
      return res.status(400).json({ error: "Tags query parameter is required" });
    }
    if (typeof tags !== "string") {
      return res.status(400).json({ error: "Tags should be a comma-separated string" });
    }

    // Split the tags into an array and trim any spaces
    const tagList = tags.split(",").map((tag) => tag.trim());

    const redisKey = `videos:tags:${tagList.join(",")}`; // Use tags to form the cache key
    const prismaQuery = {
      method: "findMany", // Use `findMany` for multiple results
      options: {
        where: {
          tags: {
            hasSome: tagList, // `hasSome` allows matching any of the provided tags
          },
        },
      },
    };

    // Call the fetchAndCache function to fetch and cache results
    await fetchAndCache("video", tags, redisKey, prismaQuery, res, next);
  } catch (err) {
    // Log the error if something goes wrong
    console.error("Error fetching videos by tags:", err);
    next(err); // Pass the error to the next middleware
  }
});




app.delete('/v1/photos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Ensure the ID is a valid string (if it's not, return an error)
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    // Soft delete the photo by setting the deletedAt field
    const deletedPhoto = await prisma.photo.update({
      where: { id: String(id) }, // Ensure id is a string
      data: { deletedAt: new Date() }, // Soft delete by setting deletedAt to the current timestamp
    });

    if (!deletedPhoto) {
      return res.status(404).json({ error: "Photo not found" });
    }

    res.json(deletedPhoto); // Respond with the updated photo, including the deletedAt field
  } catch (err) {
    // Handle Prisma error for record not found (P2025)
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Catch any other errors
    console.error('Error deleting photo:', err);
    next(err); // Pass the error to the error-handling middleware
  }
});

// Video endpoints
app.post('/v1/videos/upload', upload.single('video'), async (req, res, next) => {
  try {
    const { tags } = req.body;
    const file = req.file;

    // Check if file is provided
    if (!file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    // Check if tags are provided
    if (!tags) {
      return res.status(400).json({ error: 'Tags are required' });
    }

    // Check if the video count has exceeded the limit (20 videos)
    const videoCount = await prisma.video.count();
    if (videoCount >= 20) {
      return res.status(400).json({ error: 'Video storage limit reached (20)' });
    }

    // Create new video entry in the database
    const newVideo = await prisma.video.create({
      data: {
        url: `/uploads/${file.filename}`, // Store the file path
        tags: JSON.parse(tags), // Parse tags if sent as a JSON string
      },
    });

    // Respond with the new video data
    res.status(201).json(newVideo);
  } catch (err) {
    console.error('Error uploading video:', err);
    next(err); // Pass the error to the next middleware
  }
});
;


app.get('/v1/videos', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, tag } = req.query;

    // Parse and validate query parameters
    const currentPage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const pageSize = parseInt(limit, 10);

    // Build the `where` clause based on the optional `tag` filter
    const where = tag
      ? {
          tags: {
            has: tag.trim(),
          },
        }
      : {};

    // Fetch all videos if `limit` is 0 or not provided
    const isFetchAll = !limit || pageSize === 0;

    // Query videos and total count
    const [videos, totalVideos] = await Promise.all([
      prisma.video.findMany({
        where,
        ...(isFetchAll
          ? {} // Fetch all videos without skip/take
          : {
              skip: (currentPage - 1) * pageSize,
              take: pageSize,
            }),
      }),
      prisma.video.count({ where }),
    ]);

    const totalPages = isFetchAll ? 1 : Math.ceil(totalVideos / pageSize);

    // Return response with metadata
    res.json({
      videos,
      totalVideos,
      totalPages,
      currentPage: isFetchAll ? null : currentPage,
      hasNextPage: !isFetchAll && currentPage < totalPages,
      hasPreviousPage: !isFetchAll && currentPage > 1,
    });
  } catch (err) {
    console.error('Error fetching videos:', err);
    next(err); // Pass error to the next middleware
  }
});


// Express.js route for soft deleting a video
app.delete('/v1/videos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate that `id` is a string
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid video ID" });
    }

    // Soft delete the video by setting the deletedAt field
    const deletedVideo = await prisma.video.update({
      where: { id: id }, // Use the string id directly here
      data: { deletedAt: new Date() }, // Soft delete by setting deletedAt to current timestamp
    });

    res.json(deletedVideo); // Respond with the updated video, including the deletedAt field
  } catch (err) {
    if (err.code === 'P2025') {
      err = { status: 404, message: 'Video not found' };
    }
    next(err); // Pass the error to the error-handling middleware
  }
});

// Catch-all route for undefined routes
app.use((req, res, next) => {
  res.status(404).json({ error: 'Route not found' });
});


// Apply error handling middleware
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
