const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);
let db;
client.connect().then(() => {
  db = client.db("professional");
  console.log("✅ Connected to MongoDB → professional");
});

app.post("/save-ai-video", async (req,res)=>{
  try{
    const {subject, subtopic, description, video_url, questions} = req.body;
    if(!subject) return res.status(400).json({error:"Subject required"});
    const collection = db.collection(subject);
    const doc = {
      unitName: subtopic,
      description: description || "",
      test: questions || [],
      units: [],
      video_url,
      date_added: new Date(),
      _class:"com.padmasiniAdmin.padmasiniAdmin_1.model.UnitRequest"
    };
    const result = await collection.insertOne(doc);
    console.log(`✅ Saved in ${subject} → ${subtopic}`);
    res.json({success:true, insertedId: result.insertedId});
  }catch(err){
    console.error(err);
    res.status(500).json({error:"Failed to save"});
  }
});

app.listen(process.env.PORT || 3000, ()=> console.log("🚀 Server running"));
