const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Enhanced CORS configuration
const allowedOrigins = [
  "https://majestic-frangollo-031fed.netlify.app", // Your AI page
  "http://localhost:5173",
  "http://localhost:5174",
  "https://padmasini7-frontend.netlify.app", // Add your main app domain
  "https://ai-generative-rhk1.onrender.com", // Your own domain
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) === -1) {
      console.log('🔒 CORS blocked origin:', origin);
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    console.log('✅ CORS allowed origin:', origin);
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

// ✅ JSON body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✅ MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in .env");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("professional");
    console.log("✅ Connected to MongoDB Professional DB");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

connectDB();

// ✅ D-ID API key
if (!process.env.DID_API_KEY) {
  console.error("❌ Missing DID_API_KEY in .env");
  process.exit(1);
}
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Generate AI video (D-ID) with validation
app.post("/generate-and-upload", async (req, res) => {
  // Set CORS headers explicitly
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const { subtopic, description } = req.body;

  if (!subtopic || !description || description.trim().length < 3) {
    return res.status(400).json({
      error: "Description must be at least 3 characters for AI video generation."
    });
  }

  try {
    console.log("🎬 Starting AI video generation for:", subtopic);

    // Start video generation
    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      {
        script: { type: "text", input: description, subtitles: "false" },
        presenter_id: "amy-jcwq6j4g",
      },
      {
        headers: { Authorization: DID_API_KEY, "Content-Type": "application/json" },
        timeout: 120000, // Increased timeout
      }
    );

    const talkId = didResponse.data.id;
    let videoUrl = "";
    let status = "notDone";

    console.log("⏳ Polling for video status, talkId:", talkId);

    // Poll until video is ready (max 10 minutes)
    const startTime = Date.now();
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes

    while (status !== "done" && (Date.now() - startTime) < maxWaitTime) {
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
        timeout: 30000,
      });

      status = poll.data.status;
      console.log("📊 Video status:", status);

      if (status === "done") {
        videoUrl = poll.data.result_url;
        console.log("✅ D-ID Video ready:", videoUrl);
        break;
      } else if (status === "failed") {
        throw new Error("D-ID video generation failed");
      } else {
        // Wait 3 seconds before polling again
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (status !== "done") {
      throw new Error("Video generation timeout");
    }

    res.json({
      firebase_video_url: videoUrl,
      message: "AI video generated successfully"
    });
  } catch (err) {
    console.error("❌ D-ID API Error:", err.response?.data || err.message || err);
    res.status(500).json({
      error: err.response?.data?.details || err.response?.data?.error || err.message || "Video generation failed"
    });
  }
});

// ✅ Add Subtopic - Save initial subtopic data
app.post("/api/addSubtopic", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📥 Received subtopic payload:", payload);

    if (!payload.unitName) {
      return res.status(400).json({ error: "Missing unitName" });
    }

    // Use the correct database
    const dbConn = client.db(payload.dbname || "PadmasiniDB");
    const collection = dbConn.collection("Content");

    // Add timestamp
    const documentToInsert = {
      ...payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log("💾 Inserting subtopic document");

    const result = await collection.insertOne(documentToInsert);

    console.log("✅ Subtopic inserted successfully, ID:", result.insertedId);

    res.json({
      status: "ok",
      insertedId: result.insertedId,
      insertedSubId: result.insertedId.toString()
    });
  } catch (err) {
    console.error("❌ /api/addSubtopic error:", err);
    res.status(500).json({ error: "Failed to add subtopic: " + err.message });
  }
});

// ✅ Update Subtopic with AI Video URL
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "PadmasiniDB" } = req.body;

    console.log("🔄 Updating subtopic with AI video:", { subtopicId, aiVideoUrl });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    const dbConn = client.db(dbname);
    const collection = dbConn.collection("Content");

    const result = await collection.updateOne(
      { _id: new ObjectId(subtopicId) },
      {
        $set: {
          aiVideoUrl: aiVideoUrl,
          updatedAt: new Date()
        }
      }
    );

    console.log("✅ Subtopic updated with AI video, modified count:", result.modifiedCount);

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: "Subtopic not found" });
    }

    res.json({
      status: "ok",
      updated: result.modifiedCount,
      message: "AI video URL saved successfully"
    });
  } catch (err) {
    console.error("❌ Error updating subtopic with AI video:", err);
    res.status(500).json({ error: "Failed to update subtopic: " + err.message });
  }
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ CORS enabled for origins:`, allowedOrigins);
});
