// server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("❌ Missing MONGO_URI"); process.exit(1); }

const client = new MongoClient(MONGO_URI);
let db;
async function initMongo(){ try{ await client.connect(); db=client.db("professional"); console.log("✅ MongoDB connected"); }catch(err){ console.error(err); process.exit(1);} }
initMongo();

const DID_API_KEY = `Bearer ${process.env.DID_API_KEY}`;

app.get("/", (req,res)=>{ res.sendFile(path.join(__dirname,"public","index.html")); });

// Generate Video
app.post("/generate-and-upload", async (req,res)=>{
  const { subtopicId, subtopicName, description } = req.body;
  if(!description || !subtopicName) return res.status(400).json({error:"Missing fields"});
  try{
    const didResponse = await axios.post("https://api.d-id.com/talks",{
      script:{type:"text", input:description, subtitles:"false"},
      presenter_id:"amy-jcwq6j4g"
    }, { headers:{ Authorization:DID_API_KEY, "Content-Type":"application/json"} });

    const talkId = didResponse.data.id;
    let videoUrl="", status="notDone", retries=0;
    while(status!=="done" && retries<60){
      const poll = await axios.get(`https://api.d-id.com/talks/${talkId}`,{headers:{Authorization:DID_API_KEY}});
      status = poll.data.status;
      if(status==="done"){ videoUrl = poll.data.result_url || poll.data.result_url_signed; break; }
      await new Promise(r=>setTimeout(r,2000)); retries++;
    }
    if(status!=="done") return res.status(500).json({error:"Video generation timed out"});
    res.json({firebase_video_url:videoUrl});
  } catch(err){
    console.error("❌ D-ID Error full:", err.response?.status, err.response?.data || err.message);
    res.status(500).json({error:"Video generation failed", details:err.response?.data || err.message});
  }
});

// Save Lesson
app.post("/save-full-data", async (req,res)=>{
  if(!db) return res.status(500).json({error:"DB not ready"});
  const { subtopicId, subtopicName, description, questions, video_url, subjectName } = req.body;
  if(!subtopicName||!description||!subjectName||!video_url) return res.status(400).json({error:"Missing fields"});
  const collectionName = subjectName.trim();
  const collection = db.collection(collectionName);
  try{
    let filter = {};
    if(subtopicId && ObjectId.isValid(subtopicId)){ filter={_id:new ObjectId(subtopicId)}; }
    else{ filter={_id:new ObjectId()}; }
    const update={$set:{ subtopicName, description, videoUrl:video_url, questions:questions||[], date_added:new Date() }};
    await collection.updateOne(filter, update, {upsert:true});
    res.json({message:"✅ Data saved successfully."});
  }catch(err){ console.error(err); res.status(500).json({error:"DB save failed"}); }
});

app.listen(PORT,()=>console.log(`✅ Server running at http://localhost:${PORT}`));
