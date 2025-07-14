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
Gabriel Pettis
Gia Hajela
Graham Reyne
Jace Revenaugh
Joshua Li
Rayan Ardestani
Ryan Gilani
Tristan Downey
Ved Hajela
Vivaan Sivakumar
Wesley McCracken
Artemis Henderson
Khoi Tran
Luca Ransdell
Trent Howarth
Mack Ho-Choi
David Silva
Caleb Kucera
Ellen Chen
Hannah Chen
Mia Mukherji
Paz Glaser
Max Mrynskyi
Mukund Shankar
Dylan Rose
Lukas Reich
Isla Maani
Iddo Vonshak
Deris Tas
Oliver Liao
Asher Luna
Katie Bella Gonzalez
Ezra Margolis
Rithi Srikannan
Manny McChesney
Anna Kysenko
Andrew Heintz
Walter Magnuson Jr.
Keanu Winslade
Grayson Manalo
Andrew Stapleton
Michael Pattinson
Lucas Orozco
Hunter Renshaw
Kaeden Chan
Lincoln Melkoumian
Blake Busa
Kaitlyn King
Vedika Raman
Dylan Rohm
Arjun Rawat
Caleb Liu
Mir Tiwari
Alex Herz
Ren Dhanasarnsombat
Ran Dhanasarnsombat
Rohan Musunuri
Vlad Garmash
Ronish Adhikary
Jaron Bernstein
Kayla Bernstein
Julia Aung
Stas Guliaev
Adrian Tang
Masen Boston
Christophe Ervin
Silas Nay
Will Templeton
Lucho Caballero
Maya Caballero
Arrietty Akane Fukuto
Ethan Xu
Joe Cruz
Taylor Lee
Jadyn Lee
Tomas Araiza
Roshan Raju
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
