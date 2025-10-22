const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS configuration
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
      return callback(new Error('CORS policy violation'), false);
    }
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

// ✅ Generate AI video (D-ID)
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

// ✅ FIXED: Debug endpoint for Spring Boot MongoDB structure
app.get("/api/debug-subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "professional" } = req.query;

    console.log("🔍 Debugging subtopic in Spring Boot structure:", id);

    const dbConn = getDB(dbname);

    // Get all collections to find where the subtopic exists
    const collections = await dbConn.listCollections().toArray();
    let foundSubtopic = null;
    let foundCollection = null;
    let foundLocation = null;


    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      // Search 1: As main document
      try {
        const mainDoc = await collection.findOne({ _id: new ObjectId(id) });
        if (mainDoc) {
          foundSubtopic = mainDoc;
          foundCollection = collectionName;
          foundLocation = "main_document";
          console.log(`✅ Found as main document in ${collectionName}`);
          break;
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }

      // Search 2: In units array (nested subtopic)
      const parentWithUnits = await collection.findOne({
        "units.id": id
      });

      if (parentWithUnits) {
        const nestedUnit = parentWithUnits.units.find(unit => unit.id === id);
        if (nestedUnit) {
          foundSubtopic = nestedUnit;
          foundCollection = collectionName;
          foundLocation = "nested_in_units";
          foundSubtopic.parentDocument = {
            _id: parentWithUnits._id,
            unitName: parentWithUnits.unitName
          };
          console.log(`✅ Found as nested unit in ${collectionName}`);
          break;
        }
      }

      // Search 3: In any field containing this ID
      const anyDoc = await collection.findOne({
        $or: [
          { _id: id },
          { "units.id": id },
          { parentId: id },
          { rootUnitId: id }
        ]
      });

      if (anyDoc) {
        foundSubtopic = anyDoc;
        foundCollection = collectionName;
        foundLocation = "any_field";
        console.log(`✅ Found in ${collectionName} in field search`);
        break;
      }
    }

    if (foundSubtopic) {
      res.json({
        found: true,
        location: foundLocation,
        collection: foundCollection,
        subtopic: foundSubtopic,
        message: "Subtopic found successfully"
      });
    } else {
      // List available collections and sample data for debugging
      const collectionSamples = {};
      for (const collectionInfo of collections.slice(0, 5)) {
        const collectionName = collectionInfo.name;
        const sampleDocs = await dbConn.collection(collectionName)
          .find({})
          .limit(2)
          .toArray();

        collectionSamples[collectionName] = sampleDocs.map(doc => ({
          _id: doc._id,
          unitName: doc.unitName,
          hasUnits: !!doc.units,
          unitsCount: doc.units?.length || 0
        }));
      }

      res.json({
        found: false,
        message: "Subtopic not found in any collection",
        debug: {
          searchedId: id,
          availableCollections: collections.map(c => c.name),
          sampleData: collectionSamples
        }
      });
    }

  } catch (err) {
    console.error("❌ Debug error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Update Subtopic AI Video URL for Spring Boot structure
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "professional" } = req.body;

    console.log("🔄 Updating subtopic AI video:", { subtopicId, aiVideoUrl, dbname });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    const dbConn = getDB(dbname);
    let result;
    let updateLocation = "unknown";
    let updatedCollection = "unknown";

    // Search through all collections
    const collections = await dbConn.listCollections().toArray();

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      // Try to update as nested unit first (most common case)
      result = await collection.updateOne(
        { "units.id": subtopicId },
        {
          $set: {
            "units.$.aiVideoUrl": aiVideoUrl,
            "units.$.updatedAt": new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        updateLocation = "nested_unit";
        updatedCollection = collectionName;
        console.log(`✅ Updated nested unit in ${collectionName}`);
        break;
      }

      // Try to update as main document
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
          updatedCollection = collectionName;
          console.log(`✅ Updated main document in ${collectionName}`);
          break;
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }
    }

    console.log("🔍 Final result - Matched:", result?.matchedCount, "Modified:", result?.modifiedCount);

    if (!result || result.matchedCount === 0) {
      console.log("❌ No documents matched in any collection.");

      return res.status(404).json({
        error: "Subtopic not found. The subtopic might not exist or was not saved properly.",
        subtopicId: subtopicId,
        debug: {
          collectionsSearched: collections.map(c => c.name),
          suggestion: "Make sure the subtopic was saved via Spring Boot backend first"
        }
      });
    }

    console.log("✅ AI video URL saved successfully! Location:", updateLocation, "Collection:", updatedCollection);

    res.json({
      status: "ok",
      updated: result.modifiedCount,
      location: updateLocation,
      collection: updatedCollection,
      message: "AI video URL saved successfully"
    });

  } catch (err) {
    console.error("❌ Error updating subtopic:", err);
    res.status(500).json({ error: "Failed to update subtopic: " + err.message });
  }
});

// ✅ NEW: Direct Spring Boot communication endpoint
app.post("/api/communicate-with-springboot", async (req, res) => {
  try {
    const { action, data, springBootUrl = "http://localhost:8080" } = req.body;

    console.log("🔄 Communicating with Spring Boot:", { action, springBootUrl });

    let response;

    switch (action) {
      case "debugSubtopic":
        response = await axios.get(`${springBootUrl}/api/debug-subtopic/${data.subtopicId}?dbname=${data.dbname}`);
        break;

      case "updateSubtopicVideo":
        response = await axios.put(`${springBootUrl}/api/updateSubtopicVideo`, data);
        break;

      default:
        throw new Error("Unknown action: " + action);
    }

    res.json({
      status: "ok",
      springBootResponse: response.data
    });

  } catch (err) {
    console.error("❌ Spring Boot communication error:", err.message);
    res.status(500).json({
      error: "Failed to communicate with Spring Boot: " + err.message
    });
  }
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Node.js AI Video Backend"
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    message: "Node.js backend is working!",
    purpose: "AI Video Generation for Spring Boot subtopics"
  });
});

// ✅ NEW: Database inspection endpoint
app.get("/api/inspect-database", async (req, res) => {
  try {
    const { dbname = "professional" } = req.query;
    const dbConn = getDB(dbname);

    const collections = await dbConn.listCollections().toArray();
    const databaseInfo = {};

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      const count = await collection.countDocuments();
      const sample = await collection.find({}).limit(3).toArray();

      databaseInfo[collectionName] = {
        documentCount: count,
        sample: sample.map(doc => ({
          _id: doc._id,
          unitName: doc.unitName,
          parentId: doc.parentId,
          hasUnits: !!doc.units,
          units: doc.units?.map(u => ({ id: u.id, unitName: u.unitName })) || []
        }))
      };
    }

    res.json({
      database: dbname,
      collections: databaseInfo
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Node.js Server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Configured for Spring Boot MongoDB structure`);
  console.log(`✅ AI Video Generation Service Ready`);
});
