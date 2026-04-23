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

// Rate limiting (5/day per IP)
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  if (count >= 5) return false;
  rateLimitMap.set(key, count + 1);
  return true;
}

// GET usage
app.get("/api/usage", (req, res) => {
  const today = new Date().toDateString();
  const key = `${req.ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  res.json({ used: count, limit: 5 });
});

// POST upscale
app.post("/api/upscale", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path;

  try {
    if (!checkRateLimit(req.ip)) {
      return res.status(429).json({
        error: "Daily free limit reached (5 images). Upgrade to Pro for unlimited!",
        upgradeRequired: true,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const scale = parseInt(req.body.scale) || 2;
    console.log(`Upscaling image with Deep-Image.ai, scale=${scale}x...`);

    const imageBuffer = fs.readFileSync(filePath);

    // Step 1: Submit job to Deep-Image API
    const form = new FormData();
    form.append("image", imageBuffer, {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype,
    });
    form.append("scale", scale.toString());

    const submitRes = await fetch("https://api.deep-image.ai/rest_api/process_result", {
      method: "POST",
      headers: {
        "x-api-key": process.env.DEEPIMAGE_API_KEY,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error("Deep-Image submit error:", errText);
      throw new Error(`Deep-Image error: ${submitRes.status} — ${errText}`);
    }

    const result = await submitRes.json();
    console.log("Deep-Image response:", result);

    // Deep-Image returns output URL directly
    const outputUrl = result.output_url || result.url || result.result_url;

    if (!outputUrl) {
      throw new Error("No output URL received from Deep-Image API");
    }

    res.json({
      success: true,
      outputUrl: outputUrl,
      scale: scale,
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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "UpscaleAI Backend — Deep-Image.ai" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`UpscaleAI backend running on port ${PORT}`);
});
