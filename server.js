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
    const { dbname = "professional", subjectName } = req.query;

    console.log("🔍 Debugging subtopic in Spring Boot structure:", { id, dbname, subjectName });

    const dbConn = getDB(dbname);

    // If subjectName is provided, search only in that collection
    if (subjectName) {
      const collection = dbConn.collection(subjectName);

      // Search 1: As nested unit in "units" array
      const parentDoc = await collection.findOne({ "units.id": id });
      if (parentDoc) {
        const nestedUnit = parentDoc.units.find(unit => unit.id === id);
        return res.json({
          found: true,
          location: "nested_in_units",
          collection: subjectName,
          subtopic: nestedUnit,
          parentDocument: {
            _id: parentDoc._id,
            unitName: parentDoc.unitName
          },
          message: "Subtopic found as nested unit"
        });
      }

      // Search 2: As main document
      try {
        const mainDoc = await collection.findOne({ _id: new ObjectId(id) });
        if (mainDoc) {
          return res.json({
            found: true,
            location: "main_document",
            collection: subjectName,
            subtopic: mainDoc,
            message: "Subtopic found as main document"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }
    }

    // If not found with subjectName, search all collections
    const collections = await dbConn.listCollections().toArray();

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      // Search in nested units
      const parentDoc = await collection.findOne({ "units.id": id });
      if (parentDoc) {
        const nestedUnit = parentDoc.units.find(unit => unit.id === id);
        return res.json({
          found: true,
          location: "nested_in_units",
          collection: collectionName,
          subtopic: nestedUnit,
          parentDocument: {
            _id: parentDoc._id,
            unitName: parentDoc.unitName
          },
          message: "Subtopic found as nested unit"
        });
      }

      // Search as main document
      try {
        const mainDoc = await collection.findOne({ _id: new ObjectId(id) });
        if (mainDoc) {
          return res.json({
            found: true,
            location: "main_document",
            collection: collectionName,
            subtopic: mainDoc,
            message: "Subtopic found as main document"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }
    }

    res.json({
      found: false,
      message: "Subtopic not found in any collection",
      searchedId: id,
      suggestion: "Make sure the subtopic was saved via Spring Boot backend first"
    });

  } catch (err) {
    console.error("❌ Debug error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Update Subtopic AI Video URL for Spring Boot structure
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "professional", subjectName } = req.body;

    console.log("🔄 Updating subtopic AI video:", { subtopicId, aiVideoUrl, dbname, subjectName });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    const dbConn = getDB(dbname);
    let result;
    let updateLocation = "unknown";
    let updatedCollection = "unknown";

    // Search strategy: Try with subjectName first, then all collections
    const searchCollections = subjectName ? [subjectName] : await dbConn.listCollections().then(cols => cols.map(c => c.name));

    for (const collectionName of searchCollections) {
      const collection = dbConn.collection(collectionName);

      // 🔍 Try to update as nested unit in "units" array (most common case for Spring Boot)
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

      // 🔍 Try to update as main document
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
        console.log(`⚠️ ${subtopicId} is not a valid ObjectId in collection ${collectionName}`);
      }
    }

    if (!result || result.matchedCount === 0) {
      console.log("❌ No documents matched in any collection.");

      // Enhanced debugging
      const debugInfo = {
        subtopicId: subtopicId,
        collectionsSearched: searchCollections,
        suggestion: "The subtopic might not exist or was not saved properly via Spring Boot"
      };

      return res.status(404).json({
        error: "Subtopic not found",
        debug: debugInfo
      });
    }

    console.log("✅ AI video URL saved successfully!", {
      location: updateLocation,
      collection: updatedCollection,
      matched: result.matchedCount,
      modified: result.modifiedCount
    });

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

// ✅ Test Spring Boot connection
app.get("/api/test-springboot-connection", async (req, res) => {
  try {
    const { subtopicId, dbname = "professional", subjectName } = req.query;

    const dbConn = getDB(dbname);
    const collection = dbConn.collection(subjectName);

    // Find parent document containing the subtopic
    const parentDoc = await collection.findOne({ "units.id": subtopicId });

    res.json({
      found: !!parentDoc,
      parentDocument: parentDoc ? {
        _id: parentDoc._id,
        unitName: parentDoc.unitName,
        unitsCount: parentDoc.units?.length || 0
      } : null,
      subtopic: parentDoc ? parentDoc.units.find(u => u.id === subtopicId) : null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
