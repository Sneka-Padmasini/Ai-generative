// ✅ server.js — Full Dynamic AI Video + MongoDB + Frontend

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(
  cors({
    origin: "https://majestic-frangollo-031fed.netlify.app",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());
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
let collections = {};

client.connect().then(() => {
  db = client.db("professional");
  const subjects = ["Botany", "Chemistry", "General", "Maths", "Physics", "Zoology"];
  subjects.forEach((s) => (collections[s.toLowerCase()] = db.collection(s.toLowerCase())));
  console.log("✅ Connected to MongoDB Professional DB");
});

// ✅ D-ID API key
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Generate AI video
app.post("/generate-and-upload", async (req, res) => {
  const { subtopic, description } = req.body;
  if (!subtopic || !description) return res.status(400).json({ error: "Missing subtopic or description" });

  try {
    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      { script: { type: "text", input: description, subtitles: "false" }, presenter_id: "amy-jcwq6j4g" },
      { headers: { Authorization: DID_API_KEY, "Content-Type": "application/json" } }
    );

    const talkId = didResponse.data.id;
    let videoUrl = "";
    let status = "notDone";

    while (status !== "done") {
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, { headers: { Authorization: DID_API_KEY } });
      status = poll.data.status;
      if (status === "done") videoUrl = poll.data.result_url;
      else await new Promise((r) => setTimeout(r, 2000));
    }

    res.json({ firebase_video_url: videoUrl });
  } catch (err) {
    console.error("❌ D-ID API Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Video generation failed" });
  }
});

// ✅ Add Subtopic (new route)
app.post("/api/addSubtopic", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.unitName) return res.status(400).json({ error: "Missing unitName" });

    const collection = db.collection("Content"); // adjust if needed
    const result = await collection.insertOne(payload);

    res.json({ status: "ok", insertedId: result.insertedId });
  } catch (err) {
    console.error("❌ /api/addSubtopic error:", err);
    res.status(500).json({ error: "Failed to add subtopic" });
  }
});

// ✅ Update AI video + test data
app.post("/api/content/updateUnitAI", async (req, res) => {
  try {
    const { unitId, videoUrl, aiTestData } = req.body;
    if (!unitId) return res.status(400).json({ status: "error", message: "Missing unitId" });

    const dbConn = client.db("PadmasiniDB");
    const result = await dbConn.collection("Content").updateOne(
      { "units._id": new ObjectId(unitId) },
      { $set: { "units.$.aiVideoUrl": videoUrl, "units.$.aiTestData": aiTestData || [] } }
    );

    res.json({ status: "ok", updated: result.modifiedCount });
  } catch (err) {
    console.error("❌ MongoDB Update Error:", err);
    res.status(500).json({ status: "error", message: "Database update failed" });
  }
});

// ✅ Save full AI lesson dynamically
app.put("/save-full-lesson-adminstyle/:unitId", async (req, res) => {
  try {
    const { unitId } = req.params;
    const updateData = req.body;
    const subjectName = (updateData.subjectName || "physics").toLowerCase();

    if (!collections[subjectName]) return res.status(400).json({ status: "error", message: "Invalid subject name" });

    const result = await collections[subjectName].updateOne(
      { "units._id": unitId },
      {
        $set: {
          "units.$.unitName": updateData.unitName,
          "units.$.explanation": updateData.explanation,
          "units.$.audioFileId": updateData.audioFileId || [],
          "units.$.imageUrls": updateData.imageUrls || [],
          "units.$.aiVideoUrl": updateData.aiVideoUrl || "",
          "units.$.aiTestData": updateData.aiTestData || [],
        },
      }
    );

    res.json({ status: "ok", updated: result.modifiedCount });
  } catch (err) {
    console.error("❌ Error saving AI lesson:", err);
    res.status(500).json({ status: "error", message: "Failed to save lesson" });
  }
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});
