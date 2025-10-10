// server.js — D-ID + MongoDB + Frontend serving
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Serve static files from "public" folder (e.g. index.html, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// ✅ Serve index.html at "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✅ MongoDB Connection (professional DB)
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in .env file");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db;
let collections = {};

client.connect().then(() => {
  db = client.db("professional"); // ✅ professional DB
  ["Botany", "Chemistry", "General", "Maths", "Physics", "Zoology"].forEach(
    (name) => {
      collections[name.toLowerCase()] = db.collection(name);
    }
  );
  console.log("✅ Connected to MongoDB Professional DB");
});

// ✅ D-ID API Key (from .env, already Base64 encoded)
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Route: Generate Video from D-ID
app.post("/generate-and-upload", async (req, res) => {
  const { subtopic, description } = req.body;

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

    while (status !== "done") {
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
      });

      status = poll.data.status;
      if (status === "done") videoUrl = poll.data.result_url;
      else await new Promise((r) => setTimeout(r, 2000));
    }

    res.json({ firebase_video_url: videoUrl });
  } catch (err) {
    if (err.response) {
      console.error("❌ D-ID Error:", err.response.status, err.response.data);
    } else {
      console.error("❌ D-ID Error:", err.message);
    }
    res.status(500).json({ error: "Video generation failed" });
  }
});

// ✅ Route: Save to professional DB
// ✅ Route: Save to MongoDB (Dynamic collection by subject)
 // Save AI lesson like AdminRight
const { ObjectId } = require("mongodb");

// Create new AI unit under parentId
app.post("/save-full-lesson-adminstyle", async (req, res) => {
  const { courseName, subjectName, unit } = req.body;

  if (!courseName || !subjectName || !unit || !unit.parentId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const dbClient = client.db(courseName);
    const collection = dbClient.collection(subjectName);

    if (!unit._id) unit._id = new ObjectId();

    const result = await collection.updateOne(
      { _id: new ObjectId(unit.parentId) },
      { $push: { units: unit } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: "Parent unit not found" });
    }

    res.json({ message: "✅ AI lesson saved successfully!", unitId: unit._id.toString() });
  } catch (err) {
    console.error("❌ Error saving AI lesson:", err);
    res.status(500).json({ error: "Server error while saving AI lesson" });
  }
});

// Update existing AI unit dynamically
app.put("/save-full-lesson-adminstyle/:id", async (req, res) => {
  const { id } = req.params;
  const { courseName, subjectName, explanation, audioFileId, imageUrls } = req.body;

  if (!courseName || !subjectName) {
    return res.status(400).json({ error: "Missing courseName or subjectName" });
  }

  try {
    const dbClient = client.db(courseName);
    const collection = dbClient.collection(subjectName);

    const result = await collection.updateOne(
      { "units._id": new ObjectId(id) },
      {
        $set: {
          "units.$.explanation": explanation,
          "units.$.audioFileId": audioFileId,
          "units.$.imageUrls": imageUrls
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Unit not found" });
    }

    res.json({ message: "✅ AI lesson updated successfully!", modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("❌ Error updating AI lesson:", err);
    res.status(500).json({ error: "Server error while updating AI lesson" });
  }
});






// ✅ Start Server
const host = "0.0.0.0"; // Bind to all network interfaces
app.listen(PORT, host, () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
