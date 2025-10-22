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

// ✅ Spring Boot API URL (update this to your actual Spring Boot URL)
const SPRING_BOOT_URL = process.env.SPRING_BOOT_URL || "http://localhost:8080";

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

// ✅ FIXED: Debug endpoint that understands Spring Boot structure
app.get("/api/debug-subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "professional", subjectName } = req.query;

    console.log("🔍 Debugging subtopic in Spring Boot structure:", { id, dbname, subjectName });

    const dbConn = getDB(dbname);

    // Strategy 1: Search in specific subject collection if provided
    if (subjectName) {
      const subjectCollection = dbConn.collection(subjectName);

      // Search as main document with _id
      try {
        const mainDoc = await subjectCollection.findOne({ _id: new ObjectId(id) });
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

      // Search in units array (Spring Boot structure)
      const parentDoc = await subjectCollection.findOne({
        "units.id": id
      });

      if (parentDoc && parentDoc.units) {
        const nestedUnit = parentDoc.units.find(unit => unit.id === id);
        if (nestedUnit) {
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
      }
    }

    // Strategy 2: Search across all collections
    const collections = await dbConn.listCollections().toArray();

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

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

      // Search in units array
      const parentDoc = await collection.findOne({
        "units.id": id
      });

      if (parentDoc && parentDoc.units) {
        const nestedUnit = parentDoc.units.find(unit => unit.id === id);
        if (nestedUnit) {
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
      }
    }

    // Strategy 3: Try Spring Boot API directly
    try {
      console.log("🔄 Trying Spring Boot API directly...");
      const springBootResponse = await axios.get(`${SPRING_BOOT_URL}/api/debug-subtopic/${id}?dbname=${dbname}`);

      if (springBootResponse.data.found) {
        return res.json(springBootResponse.data);
      }
    } catch (springErr) {
      console.log("⚠️ Spring Boot API not available, continuing...");
    }

    // Not found
    res.json({
      found: false,
      message: "Subtopic not found in any collection",
      searchedId: id,
      dbname: dbname,
      subjectName: subjectName
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

    // Strategy 1: Try Spring Boot API first
    try {
      console.log("🔄 Attempting update via Spring Boot API...");

      const springBootResponse = await axios.put(`${SPRING_BOOT_URL}/api/updateSubtopicVideo`, {
        subtopicId: subtopicId,
        aiVideoUrl: aiVideoUrl,
        dbname: dbname,
        subjectName: subjectName
      });

      if (springBootResponse.data.updated || springBootResponse.data.status === "ok") {
        return res.json({
          status: "ok",
          updated: springBootResponse.data.updated || 1,
          location: "spring_boot_api",
          message: "AI video URL saved via Spring Boot API"
        });
      }
    } catch (springErr) {
      console.log("⚠️ Spring Boot API not available, falling back to direct DB update...");
    }

    // Strategy 2: Direct MongoDB update (for Spring Boot structure)
    console.log("🔄 Attempting direct MongoDB update...");

    // Search in specific subject collection first
    if (subjectName) {
      const subjectCollection = dbConn.collection(subjectName);

      // Update nested unit in units array
      result = await subjectCollection.updateOne(
        { "units.id": subtopicId },
        {
          $set: {
            "units.$.aiVideoUrl": aiVideoUrl,
            "units.$.updatedAt": new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        return res.json({
          status: "ok",
          updated: result.modifiedCount,
          location: "nested_unit",
          collection: subjectName,
          message: "AI video URL saved to nested unit"
        });
      }

      // Update as main document
      try {
        result = await subjectCollection.updateOne(
          { _id: new ObjectId(subtopicId) },
          {
            $set: {
              aiVideoUrl: aiVideoUrl,
              updatedAt: new Date()
            }
          }
        );

        if (result.matchedCount > 0) {
          return res.json({
            status: "ok",
            updated: result.modifiedCount,
            location: "main_document",
            collection: subjectName,
            message: "AI video URL saved to main document"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }
    }

    // Strategy 3: Search across all collections
    const collections = await dbConn.listCollections().toArray();

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      // Update nested unit
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
        return res.json({
          status: "ok",
          updated: result.modifiedCount,
          location: "nested_unit",
          collection: collectionName,
          message: "AI video URL saved to nested unit"
        });
      }

      // Update main document
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
          return res.json({
            status: "ok",
            updated: result.modifiedCount,
            location: "main_document",
            collection: collectionName,
            message: "AI video URL saved to main document"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, continue
      }
    }

    // Not found
    return res.status(404).json({
      error: "Subtopic not found in database",
      subtopicId: subtopicId,
      suggestion: "Make sure the subtopic was created via Spring Boot /api/addSubtopic endpoint first"
    });

  } catch (err) {
    console.error("❌ Error updating subtopic:", err);
    res.status(500).json({ error: "Failed to update subtopic: " + err.message });
  }
});

// ✅ NEW: Create a Spring Boot compatible endpoint for your frontend
app.post("/api/create-subtopic-springboot", async (req, res) => {
  try {
    const { parentId, unitName, description, dbname, subjectName } = req.body;

    console.log("🔄 Creating subtopic via Spring Boot API:", { parentId, unitName, dbname, subjectName });

    // Call your Spring Boot /api/addSubtopic endpoint
    const springBootResponse = await axios.post(`${SPRING_BOOT_URL}/api/addSubtopic`, {
      dbname: dbname,
      subjectName: subjectName,
      parentId: parentId,
      unitName: unitName,
      description: description
    });

    res.json({
      success: true,
      springBootResponse: springBootResponse.data,
      subtopicId: springBootResponse.data.insertedSubId
    });

  } catch (err) {
    console.error("❌ Error creating subtopic via Spring Boot:", err.message);
    res.status(500).json({
      error: "Failed to create subtopic: " + err.message
    });
  }
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Node.js AI Video Backend",
    springBootUrl: SPRING_BOOT_URL
  });
});

// ✅ Database inspection endpoint
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
      const sample = await collection.find({}).limit(2).toArray();

      databaseInfo[collectionName] = {
        documentCount: count,
        sample: sample.map(doc => ({
          _id: doc._id,
          unitName: doc.unitName,
          parentId: doc.parentId,
          hasUnits: !!doc.units,
          unitsCount: doc.units?.length || 0,
          unitsSample: doc.units?.slice(0, 2).map(u => ({ id: u.id, unitName: u.unitName })) || []
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
  console.log(`✅ Configured for Spring Boot integration: ${SPRING_BOOT_URL}`);
  console.log(`✅ AI Video Generation Service Ready`);
});
