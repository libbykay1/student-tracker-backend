const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT;

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

// GET all students (name + slug)
app.get("/students", async (req, res) => {
  try {
    const students = await studentsCollection
      .find({}, { projection: { _id: 0, name: 1, slug: 1 } })
      .toArray();

    res.json(students);
  } catch (err) {
    console.error("Failed to fetch students:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// One-time route to import active students
app.post("/import-active-students", async (req, res) => {
  const studentNames = `

  `.trim().split('\n').map(name => name.trim());

  // Deduplicate just in case
  const uniqueNames = [...new Set(studentNames)];

  const studentDocs = uniqueNames.map(name => {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return { name, slug, progress: {} };
  });

  try {
    const result = await studentsCollection.insertMany(studentDocs, { ordered: false });
    res.json({ insertedCount: result.insertedCount });
  } catch (err) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Some duplicates skipped", message: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Bulk insert failed", message: err.message });
    }
  }
});
