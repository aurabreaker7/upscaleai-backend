const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const fetch = require("node-fetch");
const FormData = require("form-data");
require("dotenv").config();

const app = express();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

app.use(cors());
app.use(express.json());

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  if (count >= 5) return false;
  rateLimitMap.set(key, count + 1);
  return true;
}

app.get("/api/usage", (req, res) => {
  const ip = req.ip;
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  res.json({ used: count, limit: 5 });
});

app.post("/api/upscale", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path;

  try {
    const ip = req.ip;

    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: "Daily free limit reached (5 images). Upgrade to Pro for unlimited!",
        upgradeRequired: true,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    console.log("Upscaling image with Clipdrop...");

    const imageBuffer = fs.readFileSync(filePath);

    const form = new FormData();
    form.append("image_file", imageBuffer, {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype,
    });

    const response = await fetch("https://clipdrop-api.co/image-upscaling/v1/upscale", {
      method: "POST",
      headers: {
        "x-api-key": process.env.CLIPDROP_API_KEY,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Clipdrop error:", errText);
      throw new Error(`Clipdrop error: ${response.status} — ${errText}`);
    }

    const imageArrayBuffer = await response.arrayBuffer();
    const base64Output = Buffer.from(imageArrayBuffer).toString("base64");
    const outputDataUrl = `data:image/png;base64,${base64Output}`;

    res.json({
      success: true,
      outputUrl: outputDataUrl,
      scale: 2,
      message: "Image upscaled successfully!",
    });

  } catch (err) {
    console.error("Upscale error:", err);
    res.status(500).json({
      error: err.message || "Upscaling failed. Please try again.",
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "UpscaleAI Backend — Clipdrop" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`UpscaleAI backend running on port ${PORT}`);
});
