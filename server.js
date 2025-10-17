const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS configuration
const corsOptions = {
  origin: [
    "https://majestic-frangollo-031fed.netlify.app",
    "http://localhost:5173",
    "http://localhost:5174",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ✅ JSON body parsing
app.use(express.json());

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

client.connect()
  .then(() => {
    db = client.db("professional");
    console.log("✅ Connected to MongoDB Professional DB");
  })
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
  });

// ✅ D-ID API key
if (!process.env.DID_API_KEY) {
  console.error("❌ Missing DID_API_KEY in .env");
  process.exit(1);
}
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Generate AI video (D-ID) with validation
app.post("/generate-and-upload", async (req, res) => {
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
        timeout: 60000,
      }
    );

    const talkId = didResponse.data.id;
    let videoUrl = "";
    let status = "notDone";

    console.log("⏳ Polling for video status, talkId:", talkId);

    // Poll until video is ready
    while (status !== "done") {
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
        timeout: 30000,
      });

      status = poll.data.status;
      console.log("📊 Video status:", status);

      if (status === "done") {
        videoUrl = poll.data.result_url;
        console.log("✅ D-ID Video ready:", videoUrl);
      } else if (status === "failed") {
        throw new Error("D-ID video generation failed");
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
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

// ✅ Get subtopic by ID
app.get("/api/subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "PadmasiniDB" } = req.query;

    const dbConn = client.db(dbname);
    const subtopic = await dbConn.collection("Content").findOne({ _id: new ObjectId(id) });

    if (!subtopic) {
      return res.status(404).json({ error: "Subtopic not found" });
    }

    res.json(subtopic);
  } catch (err) {
    console.error("❌ Error fetching subtopic:", err);
    res.status(500).json({ error: "Failed to fetch subtopic" });
  }
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});
