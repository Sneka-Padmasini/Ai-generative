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

// ✅ Spring Boot API URL
const SPRING_BOOT_URL = process.env.SPRING_BOOT_URL || "http://localhost:80";

// ✅ Test Spring Boot connection on startup
async function testSpringBootConnection() {
  try {
    console.log(`🔗 Testing connection to Spring Boot: ${SPRING_BOOT_URL}`);
    const response = await axios.get(`${SPRING_BOOT_URL}/actuator/health`, { timeout: 5000 });
    console.log("✅ Spring Boot connection successful:", response.data);
    return true;
  } catch (err) {
    console.warn("⚠️ Spring Boot connection failed:", err.message);

    // Try common Spring Boot endpoints
    const endpoints = ['/api/getAllUnits/professional/Physics/10', '/actuator/health', '/'];
    for (const endpoint of endpoints) {
      try {
        const testResponse = await axios.get(`${SPRING_BOOT_URL}${endpoint}`, { timeout: 3000 });
        console.log(`✅ Spring Boot responding at: ${endpoint}`);
        return true;
      } catch (e) {
        console.log(`❌ Spring Boot not responding at: ${endpoint}`);
      }
    }

    return false;
  }
}

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

// ✅ IMPROVED: Debug endpoint with better Spring Boot connection handling
app.get("/api/debug-subtopic/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { dbname = "professional", subjectName } = req.query;

    console.log("🔍 Debugging subtopic:", { id, dbname, subjectName });

    const dbConn = getDB(dbname);

    // Strategy 1: Use Spring Boot debug endpoint first
    let springBootConnected = false;
    try {
      console.log(`🔄 Trying Spring Boot debug endpoint: ${SPRING_BOOT_URL}/api/debug-subtopic/${id}`);

      const springBootResponse = await axios.get(
        `${SPRING_BOOT_URL}/api/debug-subtopic/${id}?dbname=${dbname}&subjectName=${subjectName}`,
        { timeout: 5000 }
      );

      springBootConnected = true;
      console.log("✅ Spring Boot debug response received");

      if (springBootResponse.data.foundInUnitsWithId ||
        springBootResponse.data.foundInUnitsWith_Id ||
        springBootResponse.data.foundAsMain) {

        console.log("✅ Subtopic found via Spring Boot debug");
        return res.json({
          found: true,
          location: "spring_boot_debug",
          collection: subjectName,
          debugInfo: springBootResponse.data,
          springBootConnected: true,
          message: "Subtopic found via Spring Boot debug endpoint"
        });
      } else {
        console.log("❌ Subtopic not found via Spring Boot debug");
      }
    } catch (springErr) {
      console.log("⚠️ Spring Boot debug endpoint not available:", springErr.message);
      springBootConnected = false;
    }

    // Strategy 2: Direct MongoDB search with subjectName
    if (subjectName) {
      console.log(`🔍 Searching directly in MongoDB collection: ${subjectName}`);

      const subjectCollection = dbConn.collection(subjectName);

      // Search in units array with "id" field (your Spring Boot structure)
      const parentWithUnits = await subjectCollection.findOne({
        "units.id": id
      });

      if (parentWithUnits && parentWithUnits.units) {
        const nestedUnit = parentWithUnits.units.find(unit => unit.id === id);
        if (nestedUnit) {
          console.log("✅ Subtopic found as nested unit with 'id' field");
          return res.json({
            found: true,
            location: "nested_in_units",
            collection: subjectName,
            subtopic: nestedUnit,
            parentDocument: {
              _id: parentWithUnits._id,
              unitName: parentWithUnits.unitName
            },
            springBootConnected: springBootConnected,
            message: "Subtopic found as nested unit with 'id' field"
          });
        }
      }

      // Search in units array with "_id" field
      const parentWithUnitsAlt = await subjectCollection.findOne({
        "units._id": id
      });

      if (parentWithUnitsAlt && parentWithUnitsAlt.units) {
        const nestedUnit = parentWithUnitsAlt.units.find(unit => unit._id === id);
        if (nestedUnit) {
          console.log("✅ Subtopic found as nested unit with '_id' field");
          return res.json({
            found: true,
            location: "nested_in_units",
            collection: subjectName,
            subtopic: nestedUnit,
            parentDocument: {
              _id: parentWithUnitsAlt._id,
              unitName: parentWithUnitsAlt.unitName
            },
            springBootConnected: springBootConnected,
            message: "Subtopic found as nested unit with '_id' field"
          });
        }
      }

      // Search as main document with ObjectId
      try {
        const mainDoc = await subjectCollection.findOne({ _id: new ObjectId(id) });
        if (mainDoc) {
          console.log("✅ Subtopic found as main document with ObjectId");
          return res.json({
            found: true,
            location: "main_document",
            collection: subjectName,
            subtopic: mainDoc,
            springBootConnected: springBootConnected,
            message: "Subtopic found as main document with ObjectId"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, try as string
        const mainDocString = await subjectCollection.findOne({ _id: id });
        if (mainDocString) {
          console.log("✅ Subtopic found as main document with string ID");
          return res.json({
            found: true,
            location: "main_document",
            collection: subjectName,
            subtopic: mainDocString,
            springBootConnected: springBootConnected,
            message: "Subtopic found as main document with string ID"
          });
        }
      }

      // Count documents in collection for debugging
      const docCount = await subjectCollection.countDocuments();
      console.log(`📊 Collection ${subjectName} has ${docCount} documents`);

      // Get a sample document to see structure
      const sampleDoc = await subjectCollection.findOne({});
      if (sampleDoc) {
        console.log("📋 Sample document structure:", {
          _id: sampleDoc._id,
          unitName: sampleDoc.unitName,
          hasUnits: !!sampleDoc.units,
          unitsCount: sampleDoc.units ? sampleDoc.units.length : 0,
          firstUnit: sampleDoc.units ? sampleDoc.units[0] : null
        });
      }
    }

    // Strategy 3: Search across all collections
    console.log("🔍 Searching across all collections...");
    const collections = await dbConn.listCollections().toArray();
    console.log(`📚 Available collections: ${collections.map(c => c.name).join(', ')}`);

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = dbConn.collection(collectionName);

      // Search in units array
      const parentWithUnits = await collection.findOne({
        "units.id": id
      });

      if (parentWithUnits && parentWithUnits.units) {
        const nestedUnit = parentWithUnits.units.find(unit => unit.id === id);
        if (nestedUnit) {
          console.log(`✅ Subtopic found in collection: ${collectionName}`);
          return res.json({
            found: true,
            location: "nested_in_units",
            collection: collectionName,
            subtopic: nestedUnit,
            parentDocument: {
              _id: parentWithUnits._id,
              unitName: parentWithUnits.unitName
            },
            springBootConnected: springBootConnected,
            message: `Subtopic found as nested unit in collection: ${collectionName}`
          });
        }
      }
    }

    // Not found
    console.log("❌ Subtopic not found in any collection");
    res.json({
      found: false,
      message: "Subtopic not found in any collection",
      searchedId: id,
      dbname: dbname,
      subjectName: subjectName,
      springBootConnected: springBootConnected,
      suggestion: [
        "1. Make sure the subtopic was created via Spring Boot /api/addSubtopic",
        "2. Verify the subjectName matches the collection name",
        "3. Check if the subtopicId is correct",
        `4. Spring Boot connection: ${springBootConnected ? 'Connected' : 'Not connected'}`
      ]
    });

  } catch (err) {
    console.error("❌ Debug error:", err);
    res.status(500).json({
      error: err.message,
      message: "Error while searching for subtopic"
    });
  }
});

// ✅ IMPROVED: Update Subtopic AI Video URL - Direct Spring Boot API call
app.put("/api/updateSubtopicVideo", async (req, res) => {
  try {
    const { subtopicId, aiVideoUrl, dbname = "professional", subjectName } = req.body;

    console.log("🔄 Updating subtopic AI video:", { subtopicId, aiVideoUrl, dbname, subjectName });

    if (!subtopicId || !aiVideoUrl) {
      return res.status(400).json({
        error: "Missing subtopicId or aiVideoUrl"
      });
    }

    if (!subjectName) {
      return res.status(400).json({
        error: "subjectName is required to identify the correct collection"
      });
    }

    // Strategy 1: Call Spring Boot API directly (RECOMMENDED)
    try {
      console.log("🔄 Calling Spring Boot API to update subtopic...");

      const springBootResponse = await axios.put(
        `${SPRING_BOOT_URL}/api/updateSubtopicVideo`,
        {
          subtopicId: subtopicId,
          aiVideoUrl: aiVideoUrl,
          dbname: dbname,
          subjectName: subjectName
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log("✅ Spring Boot response:", springBootResponse.data);

      return res.json({
        status: "ok",
        updated: springBootResponse.data.updated || 1,
        location: "spring_boot_api",
        springBootResponse: springBootResponse.data,
        message: "AI video URL saved via Spring Boot API"
      });

    } catch (springErr) {
      console.error("❌ Spring Boot API call failed:", springErr.message);

      if (springErr.response) {
        console.error("Spring Boot error details:", springErr.response.data);
      }

      // Strategy 2: Fallback to direct MongoDB update
      console.log("🔄 Falling back to direct MongoDB update...");

      const dbConn = getDB(dbname);
      const collection = dbConn.collection(subjectName);
      let result;

      // Try updating nested unit in units array
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
          location: "nested_unit_fallback",
          collection: subjectName,
          message: "AI video URL saved to nested unit (fallback)"
        });
      }

      // Try updating as main document
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
            location: "main_document_fallback",
            collection: subjectName,
            message: "AI video URL saved to main document (fallback)"
          });
        }
      } catch (e) {
        // Not a valid ObjectId, try as string
        result = await collection.updateOne(
          { _id: subtopicId },
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
            location: "main_document_string_fallback",
            collection: subjectName,
            message: "AI video URL saved to main document with string ID (fallback)"
          });
        }
      }

      // Not found in fallback either
      return res.status(404).json({
        error: "Subtopic not found in database",
        subtopicId: subtopicId,
        dbname: dbname,
        subjectName: subjectName,
        suggestion: [
          "1. Make sure the subtopic was created via Spring Boot /api/addSubtopic",
          "2. Verify the subjectName matches the collection name",
          "3. Check if the subtopicId is correct"
        ]
      });
    }

  } catch (err) {
    console.error("❌ Error updating subtopic:", err);
    res.status(500).json({
      error: "Failed to update subtopic: " + err.message,
      suggestion: "Check if Spring Boot server is running and accessible"
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

// ✅ Test Spring Boot connection
app.get("/api/test-springboot", async (req, res) => {
  try {
    const response = await axios.get(`${SPRING_BOOT_URL}/api/getAllUnits/professional/Physics/10`, { timeout: 5000 });
    res.json({
      springBootStatus: "connected",
      data: response.data
    });
  } catch (err) {
    res.json({
      springBootStatus: "disconnected",
      error: err.message
    });
  }
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
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ Node.js Server running on http://0.0.0.0:${PORT}`);
  console.log(`✅ Spring Boot URL: ${SPRING_BOOT_URL}`);
  console.log(`✅ AI Video Generation Service Ready`);

  // Test Spring Boot connection
  await testSpringBootConnection();
});
