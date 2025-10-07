// server.js — D-ID + MongoDB + Frontend serving
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(cors()); // ⚠️ For production, restrict to your frontend domain
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ================= MONGODB CONNECTION =================
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in .env");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db;

async function initMongo() {
  try {
    await client.connect();
    db = client.db("professional");
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}
initMongo();

// ================= D-ID CONFIG =================
const DID_API_KEY = `Bearer ${process.env.DID_API_KEY}`;

// ================= ROUTES =================

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Generate AI video using D-ID
app.post("/generate-and-upload", async (req, res) => {
  const { subtopicId, subtopicName, description } = req.body;

  if (!description || !subtopicName) {
    return res.status(400).json({ error: "Missing subtopicName or description" });
  }

  try {
    // 1️⃣ Call D-ID API
    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      {
        script: { type: "text", input: description, subtitles: "false" },
        presenter_id: "amy-jcwq6j4g",
      },
      { headers: { Authorization: DID_API_KEY, "Content-Type": "application/json" } }
    );

    const talkId = didResponse.data.id;
    let videoUrl = "";
    let status = "notDone";
    let retries = 0;

    // 2️⃣ Polling until video is ready
    while (status !== "done" && retries < 60) { // wait up to 2 minutes
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
      });

      status = poll.data.status;
      console.log("⏱ Polling D-ID:", status);

      if (status === "done") {
        videoUrl = poll.data.result_url || poll.data.result_url_signed;
        break;
      } else {
        await new Promise(r => setTimeout(r, 2000));
        retries++;
      }
    }

    if (status !== "done") {
      return res.status(500).json({ error: "Video generation timed out" });
    }

    console.log("✅ Video generated:", videoUrl);

    // Return video URL to frontend
    res.json({ firebase_video_url: videoUrl });
  } catch (err) {
    console.error("❌ D-ID Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Video generation failed", details: err.response?.data || err.message });
  }
});

// Save lesson to MongoDB dynamically based on selected subject
app.post("/save-full-data", async (req, res) => {
  if (!db) return res.status(500).json({ error: "Database not connected yet" });

  const { subtopicId, subtopicName, description, questions, video_url, subjectName } = req.body;

  if (!subtopicName || !description || !subjectName || !video_url) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const collectionName = subjectName.trim(); // dynamically select collection
  const collection = db.collection(collectionName);

  try {
    let filter = {};
    if (subtopicId && ObjectId.isValid(subtopicId)) {
      filter = { _id: new ObjectId(subtopicId) };
    } else {
      filter = { _id: new ObjectId() }; // create new doc
    }

    const update = {
      $set: {
        subtopicName,
        description,
        videoUrl: video_url,
        questions: questions || [],
        date_added: new Date(),
      },
    };

    await collection.updateOne(filter, update, { upsert: true });

    console.log(`✅ Saved lesson in collection: ${collectionName}`);
    res.json({ message: "✅ Data saved successfully." });
  } catch (err) {
    console.error("❌ MongoDB Save Error:", err.message);
    res.status(500).json({ error: "Failed to save to database" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
