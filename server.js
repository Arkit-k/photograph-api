import express from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';

import { fileURLToPath } from 'url';

dotenv.config();

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


const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
};

// Search photo by ID
app.get("/photos/:id", async (req, res, next) => {
      const { id } = req.params;
      try {
        const photo = await prisma.photo.findUnique({
          where: { id: parseInt(id, 10) },
        });
    
        if (!photo) {
          return res.status(404).json({ error: "Photo not found" });
        }
    
        res.json(photo);
      } catch (error) {
        next(err);
      }
    });
    
    // Search photos by tag name
    app.get("/photos/tag/:tagName", async (req, res, next) => {
      const { tagName } = req.params;
      try {
        const photos = await prisma.photo.findMany({
          where: {
            tags: {
              has: tagName, // Prisma array filter to check if the tag exists
            },
          },
        });
    
        if (photos.length === 0) {
          return res.status(404).json({ error: "No photos found with the given tag" });
        }
    
        res.json(photos);
      } catch (err) {
        next(err)
      }
    });


// Photo Upload Endpoint
app.post('/photos/upload', upload.single('photo'), async (req, res, next) => {
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
app.get("/videos/:id", async (req, res,next) => {
      const { id } = req.params;
      try {
        const video = await prisma.video.findUnique({
          where: { id: parseInt(id, 10) },
        });
    
        if (!video) {
          return res.status(404).json({ error: "Video not found" });
        }
    
        res.json(video);
      } catch (err) {
        next(err)
      }
    });
    
    // Search videos by tag name
app.get("/videos/tag/:tagName", async (req, res,next) => {
  const { tagName } = req.params;
  try {
    const videos = await prisma.video.findMany({
      where: {
        tags: {
          has: tagName, 
        },
      },
    });
    if (videos.length === 0) {
      return res.status(404).json({ error: "No videos found with the given tag" });
    }
    res.json(videos);
  } catch (err) {
    next(err)
  }
});
    

app.get('/photos', async (req, res, next) => {
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
    const photos = await prisma.photo.findMany({
      where,
      skip: parseInt(offset, 10),
      take: parseInt(limit, 10),
    });
    const totalPhotos = await prisma.photo.count({ where });
    const totalPages = Math.ceil(totalPhotos / limit);
    res.json({ photos, totalPhotos, totalPages, currentPage: parseInt(page, 10) });
  } catch (err) {
    next(err);
  }
});

app.delete('/photos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const deletedPhoto = await prisma.photo.delete({
      where: { id: Number(id) },
    });

    res.json(deletedPhoto);
  } catch (err) {
    if (err.code === 'P2025') {
      err = { status: 404, message: 'Photo not found' };
    }
    next(err);
  }
});

// Video endpoints
app.post('/videos/upload', upload.single('video'), async (req, res, next) => {
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


app.get('/videos', async (req, res, next) => {
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



app.delete('/videos/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const deletedVideo = await prisma.video.delete({
      where: { id: Number(id) },
    });

    res.json(deletedVideo);
  } catch (err) {
    if (err.code === 'P2025') {
      err = { status: 404, message: 'Video not found' };
    }
    next(err);
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
