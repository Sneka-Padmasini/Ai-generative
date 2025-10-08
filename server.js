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

// ✅ MongoDB Connection (from .env)
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI in .env file");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let collection;

client.connect().then(() => {
  const db = client.db("ai_teacher");
  collection = db.collection("lessons");
  console.log("✅ Connected to MongoDB");
});

// ✅ D-ID API Key (from .env, already Base64 encoded)
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Route: Generate Video from D-ID
app.post("/generate-and-upload", async (req, res) => {
  const { subtopic, description } = req.body; // ⬅️ Only subtopic + description

  try {
    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      {
        script: {
          type: "text",
          input: description,
          subtitles: "false",
        },
        presenter_id: "amy-jcwq6j4g", // Replace with your own presenter_id if needed
      },
      {
        headers: {
          Authorization: DID_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const talkId = didResponse.data.id;

    // Poll until video is ready
    let videoUrl = "";
    let status = "notDone";

    while (status !== "done") {
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: { Authorization: DID_API_KEY },
      });

      status = poll.data.status;
      if (status === "done") {
        videoUrl = poll.data.result_url;
      } else {
        await new Promise((r) => setTimeout(r, 2000));
      }
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

// ✅ Route: Save to MongoDB
app.post("/save-full-data", async (req, res) => {
  const { subtopic, description, questions, video_url } = req.body;

  try {
    const doc = {
      subtopic,
      description,
      video_url,
      questions,
      date_added: new Date(),
    };

    await collection.insertOne(doc);
    res.json({ message: "✅ Data saved successfully." });
  } catch (err) {
    console.error("❌ MongoDB Save Error:", err.message);
    res.status(500).json({ error: "Failed to save to database" });
  }
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
