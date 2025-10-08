// server.js — Dynamic save for multi-subject structure

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);

let db;
client.connect().then(() => {
  db = client.db("professional"); // ✅ Your main DB
  console.log("✅ Connected to MongoDB → professional");
});

// ==================================================
// SAVE AI VIDEO DYNAMICALLY BY SUBJECT
// ==================================================
app.post("/save-ai-video", async (req, res) => {
  try {
    const { subject, subtopic, description, video_url, questions, standard } = req.body;

    if (!subject) {
      return res.status(400).json({ error: "Subject is required" });
    }

    // ✅ Use subject dynamically as collection name
    const collection = db.collection(subject);

    const doc = {
      unitName: subtopic,             // like "Dynamics"
      description: description || "",
      standard: standard || "11",     // default 11, can be dynamic
      test: questions || [],
      units: [],
      video_url,                      // link to generated video
      date_added: new Date(),
      _class: "com.padmasiniAdmin.padmasiniAdmin_1.model.UnitRequest",
    };

    const result = await collection.insertOne(doc);
    console.log(`✅ Saved in ${subject} → ${subtopic}`);

    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("❌ Error saving AI video:", err);
    res.status(500).json({ error: "Failed to save AI video" });
  }
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
