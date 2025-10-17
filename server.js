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
  "https://majestic-frangollo-031fed.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://padmasini7-frontend.netlify.app",
  "https://ai-generative-rhk1.onrender.com",
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      console.log('🔒 CORS blocked origin:', origin);
      return callback(new Error('CORS policy violation'), false);
    }
    console.log('✅ CORS allowed origin:', origin);
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      {
        script: { type: "text", input: description, subtitles: "false" },
        presenter_id: "amy-jcwq6j4g",
      },
      {
        headers: { Authorization: DID_API_KEY, "Content-Type": "application/json" },
        timeout: 120000,
      }
    );

    const talkId = didResponse.data.id;
    let videoUrl = "";
    let status = "notDone";

    console.log("⏳ Polling for video status, talkId:", talkId);

    const startTime = Date.now();
    const maxWaitTime = 10 * 60 * 1000;

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

// ✅ Debug endpoint to check database structure
// ✅ Debug endpoint - UPDATED FOR STRING IDS
app.get("/api/debug-subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "professional" } = req.query;

    console.log("🔍 Debugging subtopic:", id);

    const dbConn = client.db(dbname);
    const collection = dbConn.collection("Content");

    const results = {};

    // Query 1: Find by units._id as STRING (correct for your DB)
    results.query1_string = await collection.findOne({ "units._id": id });
    console.log("🔍 Query 1 (units._id as string):", results.query1_string ? "FOUND" : "NOT FOUND");

    // Query 2: Try with ObjectId conversion (might fail)
    try {
      results.query2_objectId = await collection.findOne({ "units._id": new ObjectId(id) });
      console.log("🔍 Query 2 (units._id as ObjectId):", results.query2_objectId ? "FOUND" : "NOT FOUND");
    } catch (e) {
      results.query2_error = "Cannot convert to ObjectId: " + e.message;
    }

    // Query 3: Find the parent document that contains this subtopic
    results.parentDocument = await collection.findOne({
      "units": {
        $elemMatch: {
          "_id": id
        }
      }
    });

    // Show what we found
    if (results.parentDocument) {
      console.log("✅ Found parent document:", results.parentDocument._id);
      const foundUnit = results.parentDocument.units.find(unit => unit._id === id);
      if (foundUnit) {
        results.foundSubtopic = foundUnit;
        console.log("✅ Found subtopic:", foundUnit.unitName);
      }
    }

    res.json({
      subtopicId: id,
      database: dbname,
      ...results
    });

  } catch (err) {
    console.error("❌ Debug error:", err);
    res.status(500).json({ error: err.message });
  }
});
// ✅ Update Subtopic with AI Video URL - ENHANCED WITH BETTER DEBUGGING
// ✅ Update Subtopic with AI Video URL - FIXED FOR STRING IDS
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "professional" } = req.body;

    console.log("🔄 Updating subtopic with AI video:", { subtopicId, aiVideoUrl, dbname });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    const dbConn = client.db(dbname);
    const collection = dbConn.collection("Content");

    let result;
    let queryUsed = "";

    // 🎯 CRITICAL FIX: Query using STRING ID (not ObjectId)
    // Your database shows _id in units array is stored as String, not ObjectId
    queryUsed = "Query: units._id with string (correct for your DB)";
    result = await collection.updateOne(
      { "units._id": subtopicId }, // Use string directly, no ObjectId conversion
      {
        $set: {
          "units.$.aiVideoUrl": aiVideoUrl,
          updatedAt: new Date()
        }
      }
    );

    console.log("🔍 Query result - Matched:", result.matchedCount, "Modified:", result.modifiedCount);

    if (result.matchedCount === 0) {
      console.log("❌ No documents matched with string query");
      return res.status(404).json({
        error: "Subtopic not found. Make sure the subtopic exists and the ID is correct.",
        subtopicId: subtopicId,
        suggestion: "The ID exists but might be in a different format. Check database structure."
      });
    }

    console.log("✅ AI video URL saved successfully!");

    res.json({
      status: "ok",
      updated: result.modifiedCount,
      matched: result.matchedCount,
      queryUsed: queryUsed,
      message: "AI video URL saved successfully"
    });

  } catch (err) {
    console.error("❌ Error updating subtopic with AI video:", err);
    res.status(500).json({ error: "Failed to update subtopic: " + err.message });
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

    const dbConn = client.db(payload.dbname || "professional");
    const collection = dbConn.collection("Content");

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

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.get("/api/test", (req, res) => {
  res.json({ message: "Node.js backend is working!" });
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ CORS enabled for origins:`, allowedOrigins);
});
