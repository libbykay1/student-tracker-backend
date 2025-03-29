const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI);
let studentsCollection;

async function start() {
  await client.connect();
  const db = client.db("student_tracker");
  studentsCollection = db.collection("students");

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start();

// GET student progress
app.get("/students/:slug", async (req, res) => {
  const slug = req.params.slug;
  const student = await studentsCollection.findOne({ slug });
  res.json(student?.progress || {});
});

// POST student progress
app.post("/students/:slug", async (req, res) => {
  const slug = req.params.slug;
  const progress = req.body;

  await studentsCollection.updateOne(
    { slug },
    { $set: { slug, progress } },
    { upsert: true }
  );

  res.json({ success: true });
});
