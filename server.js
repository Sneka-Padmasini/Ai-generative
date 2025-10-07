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

  try {
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

    while (status !== "done" && retries < 30) { // max 60s
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
      });

      status = poll.data.status;
      if (status === "done") {
        videoUrl = poll.data.result_url;
      } else {
        await new Promise(r => setTimeout(r, 2000));
        retries++;
      }
    }

    if (status !== "done") {
      return res.status(500).json({ error: "Video generation timed out" });
    }

    res.json({ firebase_video_url: videoUrl });
  } catch (err) {
    console.error("❌ D-ID Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Video generation failed" });
  }
});

// Save lesson to MongoDB
app.post("/save-full-data", async (req, res) => {
  if (!db) return res.status(500).json({ error: "Database not connected yet" });

  const { subtopicId, subtopicName, description, questions, video_url, subjectName } = req.body;
  const collectionName = subjectName?.trim() || "General";
  const collection = db.collection(collectionName);

  try {
    let filter = {};
    if (subtopicId && ObjectId.isValid(subtopicId)) {
      filter = { _id: new ObjectId(subtopicId) };
    } else {
      // generate new ObjectId for new document
      filter = { _id: new ObjectId() };
    }

    const update = {
      $set: {
        subtopicName,
        description,
        videoUrl: video_url,
        questions,
        date_added: new Date(),
      },
    };

    await collection.updateOne(filter, update, { upsert: true });

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
