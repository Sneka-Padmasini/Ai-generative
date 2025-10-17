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

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

connectDB();

// ✅ Helper function to get database connection
function getDB(dbname = "professional") {
  return client.db(dbname);
}

// ✅ D-ID API key
if (!process.env.DID_API_KEY) {
  console.error("❌ Missing DID_API_KEY in .env");
  process.exit(1);
}
const DID_API_KEY = `Basic ${Buffer.from(process.env.DID_API_KEY).toString("base64")}`;

// ✅ Generate AI video (D-ID) with validation
app.post("/generate-and-upload", async (req, res) => {
  try {
    const { subtopic, description } = req.body;

    if (!subtopic || !description || description.trim().length < 3) {
      return res.status(400).json({
        error: "Description must be at least 3 characters for AI video generation."
      });
    }

    console.log("🎬 Starting AI video generation for:", subtopic);

    const didResponse = await axios.post(
      "https://api.d-id.com/talks",
      {
        script: { type: "text", input: description, subtitles: "false" },
        presenter_id: "amy-jcwqj4g",
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

// ✅ FIXED: Debug endpoint to find subtopic in ALL possible locations
app.get("/api/debug-subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "professional" } = req.query;

    console.log("🔍 Debugging subtopic:", id);

    const dbConn = getDB(dbname);
    const collection = dbConn.collection("Content");

    let foundLocation = null;
    let foundDocument = null;

    // 🔍 SEARCH 1: Look for document with this ID as main document
    try {
      foundDocument = await collection.findOne({ _id: new ObjectId(id) });
      if (foundDocument) {
        foundLocation = "main_document";
        console.log("✅ Found as main document");
      }
    } catch (e) {
      console.log("❌ Not a valid ObjectId for main document search");
    }

    // 🔍 SEARCH 2: Look for document with this ID in units array (nested subtopic)
    if (!foundDocument) {
      try {
        const parentDoc = await collection.findOne({ "units._id": id });
        if (parentDoc) {
          foundDocument = parentDoc;
          foundLocation = "nested_in_units";
          console.log("✅ Found as nested unit in parent document");
        }
      } catch (e) {
        console.log("❌ Error searching in units array");
      }
    }

    // 🔍 SEARCH 3: Look for document with this ID in units array using ObjectId
    if (!foundDocument) {
      try {
        const parentDoc = await collection.findOne({ "units._id": new ObjectId(id) });
        if (parentDoc) {
          foundDocument = parentDoc;
          foundLocation = "nested_in_units_objectid";
          console.log("✅ Found as nested unit using ObjectId");
        }
      } catch (e) {
        console.log("❌ Error searching in units array with ObjectId");
      }
    }

    // 🔍 SEARCH 4: Look for ANY document containing this ID anywhere
    if (!foundDocument) {
      try {
        const allDocs = await collection.find({}).toArray();
        const matchingDocs = allDocs.filter(doc =>
          JSON.stringify(doc).includes(id)
        );

        if (matchingDocs.length > 0) {
          foundDocument = matchingDocs[0];
          foundLocation = "string_search";
          console.log("✅ Found via string search");
        }
      } catch (e) {
        console.log("❌ Error in string search");
      }
    }

    if (foundDocument) {
      console.log("✅ Subtopic found in location:", foundLocation);

      // Extract the specific subtopic if it's nested
      let specificSubtopic = foundDocument;
      if (foundLocation.includes("nested")) {
        specificSubtopic = foundDocument.units?.find(unit =>
          unit._id === id || unit._id?.toString() === id
        );
      }

      res.json({
        found: true,
        location: foundLocation,
        subtopic: specificSubtopic,
        parentDocument: foundLocation.includes("nested") ? foundDocument : null,
        fullDocument: foundDocument
      });
    } else {
      console.log("❌ Subtopic not found in any location");

      // List all documents for debugging
      const allDocs = await collection.find({}).limit(10).toArray();
      const docSummary = allDocs.map(doc => ({
        _id: doc._id,
        unitName: doc.unitName,
        hasUnits: !!doc.units,
        unitsCount: doc.units?.length || 0
      }));

      res.json({
        found: false,
        message: "Subtopic not found in database",
        debug: {
          searchedId: id,
          sampleDocuments: docSummary
        }
      });
    }

  } catch (err) {
    console.error("❌ Debug error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Update Subtopic with AI Video URL - Search in ALL locations
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "professional" } = req.body;

    console.log("🔄 Node.js: Updating subtopic with AI video:", { subtopicId, aiVideoUrl, dbname });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    const dbConn = getDB(dbname);
    const collection = dbConn.collection("Content");

    let result;
    let updateLocation = "unknown";

    // 🎯 ATTEMPT 1: Update as main document
    try {
      result = await collection.updateOne(
        { _id: new ObjectId(subtopicId) },
        {
          $set: {
            aiVideoUrl: aiVideoUrl,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        updateLocation = "main_document";
        console.log("✅ Updated as main document");
      }
    } catch (e) {
      console.log("❌ Not a valid ObjectId for main document");
    }

    // 🎯 ATTEMPT 2: Update as nested unit (string ID)
    if (!result || result.matchedCount === 0) {
      result = await collection.updateOne(
        { "units._id": subtopicId },
        {
          $set: {
            "units.$.aiVideoUrl": aiVideoUrl,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        updateLocation = "nested_unit_string";
        console.log("✅ Updated as nested unit (string ID)");
      }
    }

    // 🎯 ATTEMPT 3: Update as nested unit (ObjectId)
    if (!result || result.matchedCount === 0) {
      try {
        result = await collection.updateOne(
          { "units._id": new ObjectId(subtopicId) },
          {
            $set: {
              "units.$.aiVideoUrl": aiVideoUrl,
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount > 0) {
          updateLocation = "nested_unit_objectid";
          console.log("✅ Updated as nested unit (ObjectId)");
        }
      } catch (e) {
        console.log("❌ Not a valid ObjectId for nested unit");
      }
    }

    console.log("🔍 Final result - Matched:", result?.matchedCount, "Modified:", result?.modifiedCount);

    if (!result || result.matchedCount === 0) {
      console.log("❌ No documents matched in any location.");

      // Debug: Show what's in the database
      const debugDocs = await collection.find({}).limit(5).toArray();
      console.log("📊 Sample documents:", debugDocs.map(doc => ({
        _id: doc._id,
        unitName: doc.unitName,
        hasUnits: !!doc.units,
        units: doc.units?.map(u => ({ _id: u._id, unitName: u.unitName }))
      })));

      return res.status(404).json({
        error: "Subtopic not found. Please make sure the subtopic exists in the database.",
        subtopicId: subtopicId,
        debug: {
          updateLocation: updateLocation,
          sampleDocuments: debugDocs.map(doc => ({
            _id: doc._id,
            unitName: doc.unitName,
            hasUnits: !!doc.units
          }))
        }
      });
    }

    console.log("✅ Node.js: AI video URL saved successfully! Location:", updateLocation);

    res.json({
      status: "ok",
      updated: result.modifiedCount,
      location: updateLocation,
      message: "AI video URL saved successfully via Node.js"
    });

  } catch (err) {
    console.error("❌ Node.js: Error updating subtopic:", err);
    res.status(500).json({ error: "Failed to update subtopic: " + err.message });
  }
});

// ✅ FIXED: Add Subtopic - Ensure it creates searchable documents
app.post("/api/addSubtopic", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📥 Received subtopic payload:", payload);

    if (!payload.unitName) {
      return res.status(400).json({ error: "Missing unitName" });
    }

    const dbConn = getDB(payload.dbname || "professional");
    const collection = dbConn.collection("Content");

    // Create a proper document structure that can be found later
    const documentToInsert = {
      ...payload,
      _id: payload.parentId ? new ObjectId() : new ObjectId(payload.subtopicId || undefined),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // If it's a nested subtopic, add it to the parent's units array
    if (payload.parentId) {
      console.log("💾 Adding nested subtopic to parent:", payload.parentId);

      const result = await collection.updateOne(
        { _id: new ObjectId(payload.parentId) },
        {
          $push: {
            units: {
              _id: payload.subtopicId || new ObjectId().toString(),
              unitName: payload.unitName,
              explanation: payload.explanation,
              imageUrls: payload.imageUrls || [],
              audioFileId: payload.audioFileId || [],
              aiVideoUrl: payload.aiVideoUrl || "",
              createdAt: new Date()
            }
          }
        }
      );

      console.log("✅ Nested subtopic added to parent. Matched:", result.matchedCount, "Modified:", result.modifiedCount);

      res.json({
        status: "ok",
        insertedId: payload.subtopicId || new ObjectId().toString(),
        insertedSubId: payload.subtopicId || new ObjectId().toString(),
        parentUpdated: result.modifiedCount > 0
      });
    } else {
      // It's a main document
      console.log("💾 Inserting as main document");
      const result = await collection.insertOne(documentToInsert);

      console.log("✅ Subtopic inserted as main document, ID:", result.insertedId);

      res.json({
        status: "ok",
        insertedId: result.insertedId,
        insertedSubId: result.insertedId.toString()
      });
    }
  } catch (err) {
    console.error("❌ /api/addSubtopic error:", err);
    res.status(500).json({ error: "Failed to add subtopic: " + err.message });
  }
});

// ✅ NEW: Debug all documents endpoint
app.get("/api/debug-all", async (req, res) => {
  try {
    const { dbname = "professional" } = req.query;
    const dbConn = getDB(dbname);
    const collection = dbConn.collection("Content");

    const allDocs = await collection.find({}).toArray();

    const simplifiedDocs = allDocs.map(doc => ({
      _id: doc._id,
      unitName: doc.unitName,
      parentId: doc.parentId,
      rootUnitId: doc.rootUnitId,
      hasUnits: !!doc.units,
      units: doc.units?.map(unit => ({
        _id: unit._id,
        unitName: unit.unitName,
        hasAiVideo: !!unit.aiVideoUrl
      }))
    }));

    res.json({
      totalDocuments: allDocs.length,
      documents: simplifiedDocs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
