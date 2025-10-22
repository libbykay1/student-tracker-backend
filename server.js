const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const path = require("path");

const app = express();
const PORT = process.env.PORT;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://tcssbtracker.netlify.app",   // your site
  // add any other admin domains
];

const corsOptions = {
  origin(origin, cb) {
    // Allow non-browser tools (no origin) and anything in the list
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // If you use cookies/session, also set credentials: true and specific origin
  credentials: false,
  optionsSuccessStatus: 204,
};

// 🔹 must be before routes
app.use(cors(corsOptions));
// 🔹 ensure preflight works for all routes
app.options("*", cors(corsOptions));
app.use(bodyParser.json({ limit: "25mb" }));

const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI);
let studentsCollection;

function slugify(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function start() {
  await client.connect();
  const db = client.db("student_tracker");
  studentsCollection = db.collection("students");
  await studentsCollection.createIndex({ slug: 1 }, { unique: true });

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
// POST /students - add a new student by name
app.post("/students", async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Invalid name" });
  }

  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  try {
    const result = await studentsCollection.insertOne({ name, slug, progress: {} });
    res.status(201).json({ success: true, slug });
  } catch (err) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Student already exists" });
    } else {
      console.error("Failed to add student:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.put("/students/:slug", async (req, res) => {
  const oldSlug = req.params.slug;
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Invalid name" });
  }
  const newSlug = slugify(name);

  try {
    const result = await studentsCollection.findOneAndUpdate(
      { slug: oldSlug },
      { $set: { name, slug: newSlug } },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ error: "Student not found" });
    res.json({ success: true, slug: newSlug });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Another student already uses that name/slug" });
    }
    console.error("Rename failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /students/:slug
app.delete("/students/:slug", async (req, res) => {
  try {
    const r = await studentsCollection.deleteOne({ slug: req.params.slug });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Student not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// GET /backup/students - stream all students as a downloadable JSON file (array)
// Strips _id so the file can be re-imported without clashes.
app.get("/backup/students", async (req, res) => {
  try {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `students-backup-${iso}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Start JSON array
    res.write("[");

    const cursor = studentsCollection.find({}, { projection: { _id: 0 } });
    let first = true;

    for await (const doc of cursor) {
      if (!first) res.write(",");
      else first = false;
      res.write(JSON.stringify(doc));
    }

    // End JSON array
    res.write("]");
    res.end();
  } catch (err) {
    console.error("Backup failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Backup failed" });
    } else {
      res.end();
    }
  }
});

// POST /restore/students - body should be an array of { name, slug, progress }
app.post("/restore/students", async (req, res) => {
  try {
    const payload = req.body;

    if (!Array.isArray(payload)) {
      return res.status(400).json({ error: "Body must be an array of student docs" });
    }

    // Normalize and sanitize incoming docs; ignore any _id
    const ops = payload
      .filter(d => d && typeof d.slug === "string" && d.slug.trim())
      .map(d => {
        const name = typeof d.name === "string" ? d.name : "";
        const slug = d.slug.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const progress = (d.progress && typeof d.progress === "object") ? d.progress : {};
        return {
          updateOne: {
            filter: { slug },
            update: { $set: { name, slug, progress } },
            upsert: true,
          }
        };
      });

    if (ops.length === 0) {
      return res.status(400).json({ error: "No valid docs to restore" });
    }

    const result = await studentsCollection.bulkWrite(ops, { ordered: false });
    res.json({
      ok: true,
      upserted: result.upsertedCount ?? 0,
      modified: result.modifiedCount ?? 0,
      matched: result.matchedCount ?? 0,
    });
  } catch (err) {
    console.error("Restore failed:", err);
    res.status(500).json({ error: "Restore failed", message: err.message });
  }
});
