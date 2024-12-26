import express from 'express';
import os from 'os';
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
    await redisClient.setex(redisKey, 3600, JSON.stringify(result)); // Directly await the promise

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

    // Validate that `id` is a number
    if (isNaN(id) || parseInt(id, 10) <= 0) {
      return res.status(400).json({ error: "Invalid photo ID" });
    }

    const redisKey = `photos:id:${id}`;
    const prismaQuery = {
      method: "findUnique",
      options: { where: { id: parseInt(id, 10) } },
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
    app.get("/v1/photos/tag/:tagName", async (req, res, next) => {
      try {
        const { tagName } = req.params;
    
        // Validate that `tagName` is a non-empty string
        if (!tagName || typeof tagName !== "string" || tagName.trim() === "") {
          return res.status(400).json({ error: "Invalid tag name" });
        }
    
        const redisKey = `photos:tag:${tagName}`;
        const prismaQuery = {
          method: "findMany",
          options: { where: { tags: { has: tagName } } }, // Prisma array filter
        };
    
        // Call the fetchAndCache function
        await fetchAndCache("photo", tagName, redisKey, prismaQuery, res, next);
      } catch (err) {
        // Log the error if something goes wrong
        console.error("Error fetching photos by tag:", err);
        next(err); // Pass the error to the next middleware
      }
    });
    


// Photo Upload Endpoint
app.post('/v1/photos/upload', upload.single('photo'), async (req, res, next) => {
  try {
    const { tags } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Photo file is required' });
    }

    if (!tags) {
      return res.status(400).json({ error: 'Tags are required' });
    }

    // Check if the photo count has exceeded the limit (50 photos)
    const photoCount = await prisma.photo.count();
    if (photoCount >= 50) {
      return res.status(400).json({ error: 'Photo storage limit reached (50)' });
    }

    const newPhoto = await prisma.photo.create({
      data: {
        url: `/uploads/${file.filename}`, // Store the file path
        tags: JSON.parse(tags), // Parse tags if sent as a JSON string
      },
    });

    res.status(201).json(newPhoto);
  } catch (err) {
    console.error('Error uploading photo:', err);
    next(err);
  }
});


// Search video by ID
app.get("/v1/videos/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate that `id` is a positive integer
    if (isNaN(id) || parseInt(id, 10) <= 0) {
      return res.status(400).json({ error: "Invalid video ID" });
    }

    const redisKey = `videos:id:${id}`;
    const prismaQuery = {
      method: "findUnique",
      options: { where: { id: parseInt(id, 10) } },
    };

    // Call the fetchAndCache function
    await fetchAndCache("video", id, redisKey, prismaQuery, res, next);
  } catch (err) {
    // Log and pass the error to the next middleware
    console.error("Error fetching video by ID:", err);
    next(err); // Pass the error to the next middleware
  }
});

    
    // Search videos by tag name
    app.get("/v1/videos/tag/:tagName", async (req, res, next) => {
      try {
        const { tagName } = req.params;
    
        // Validate that `tagName` is a non-empty string
        if (!tagName || typeof tagName !== "string" || tagName.trim() === "") {
          return res.status(400).json({ error: "Invalid tag name" });
        }
    
        const redisKey = `videos:tag:${tagName}`;
        const prismaQuery = {
          method: "findMany",
          options: { where: { tags: { has: tagName } } }, // Prisma array filter
        };
    
        // Call the fetchAndCache function
        await fetchAndCache("video", tagName, redisKey, prismaQuery, res, next);
      } catch (err) {
        // Log and pass the error to the next middleware
        console.error("Error fetching videos by tag:", err);
        next(err); // Pass the error to the next middleware
      }
    });
    
    

app.get('/v1/photos', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, tag } = req.query;

    // Parse pagination values
    const offset = (page - 1) * limit;
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    const where = tag
      ? {
          tags: {
            has: tag,  // Filter photos that have the specific tag
          },
        }
      : {};

    // Fetch photos with pagination and filtering
    const photos = await prisma.photo.findMany({
      where,
      skip: offset,
      take: parsedLimit,
    });

    // Get total count of photos matching the filter
    const totalPhotos = await prisma.photo.count({ where });
    const totalPages = Math.ceil(totalPhotos / parsedLimit);

    // Send the response
    res.json({
      photos,
      totalPhotos,
      totalPages,
      currentPage: parsedPage,
    });
  } catch (err) {
    next(err);
  }
});


app.delete('/v1/photos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft delete the photo by setting the deletedAt field
    const deletedPhoto = await prisma.photo.update({
      where: { id: Number(id) },
      data: { deletedAt: new Date() }, // Soft delete by setting deletedAt to current timestamp
    });

    res.json(deletedPhoto); // Respond with the updated photo, including the deletedAt field
  } catch (err) {
    if (err.code === 'P2025') {
      err = { status: 404, message: 'Photo not found' };
    }
    next(err); // Pass the error to the error-handling middleware
  }
});



// Video endpoints
app.post('/v1/videos/upload', upload.single('video'), async (req, res, next) => {
  try {
    const { tags } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    if (!tags) {
      return res.status(400).json({ error: 'Tags are required' });
    }

    // Check if the video count has exceeded the limit (20 videos)
    const videoCount = await prisma.video.count();
    if (videoCount >= 20) {
      return res.status(400).json({ error: 'Video storage limit reached (20)' });
    }

    const newVideo = await prisma.video.create({
      data: {
        url: `/uploads/${file.filename}`, // Store the file path
        tags: JSON.parse(tags), // Parse tags if sent as a JSON string
      },
    });

    res.status(201).json(newVideo);
  } catch (err) {
    console.error('Error uploading video:', err);
    next(err);
  }
});


app.get('/v1/videos', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, tag } = req.query;
    const offset = (page - 1) * limit;

    const where = tag
      ? {
          tags: {
            has: tag,
          },
        }
      : {};

    const videos = await prisma.video.findMany({
      where,
      skip: parseInt(offset, 10),
      take: parseInt(limit, 10),
    });

    const totalVideos = await prisma.video.count({ where });
    const totalPages = Math.ceil(totalVideos / limit);

    res.json({ videos, totalVideos, totalPages, currentPage: parseInt(page, 10) });
  } catch (err) {
    next(err);
  }
});

// Express.js route for soft deleting a video
app.delete('/v1/videos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft delete the video by setting the deletedAt field
    const deletedVideo = await prisma.video.update({
      where: { id: Number(id) },
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
