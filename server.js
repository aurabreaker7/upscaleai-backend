const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

app.use(cors());
app.use(express.json());

// Ensure uploads dir exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Simple in-memory rate limiting (free tier: 5/day per IP)
const rateLimitMap = new Map();
function checkRateLimit(ip, isPro = false) {
  if (isPro) return true; // Pro users unlimited
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  if (count >= 5) return false;
  rateLimitMap.set(key, count + 1);
  return true;
}

// GET usage count
app.get("/api/usage", (req, res) => {
  const ip = req.ip;
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  res.json({ used: count, limit: 5 });
});

// POST upscale endpoint
app.post("/api/upscale", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path;

  try {
    const ip = req.ip;
    const scale = parseInt(req.body.scale) || 2; // 2 or 4
    const faceEnhance = req.body.faceEnhance === "true";

    // Rate limit check
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: "Daily free limit reached (5 images). Upgrade to Pro for unlimited!",
        upgradeRequired: true,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Convert image to base64 data URI
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString("base64")}`;

    console.log(`Upscaling image: scale=${scale}x, faceEnhance=${faceEnhance}`);

    // Call Replicate - Real-ESRGAN model
    const output = await replicate.run(
      "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee2d" +
        "209e5cda0c083a72",
      {
        input: {
          image: base64Image,
          scale: scale,
          face_enhance: faceEnhance,
        },
      }
    );

    // output is a URL to the upscaled image
    res.json({
      success: true,
      outputUrl: output,
      scale: scale,
      message: `Image upscaled ${scale}x successfully!`,
    });
  } catch (err) {
    console.error("Upscale error:", err);
    res.status(500).json({
      error: err.message || "Upscaling failed. Please try again.",
    });
  } finally {
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "UpscaleAI Backend" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`UpscaleAI backend running on port ${PORT}`);
});
