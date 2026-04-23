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

// Rate limiting
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
  const today = new Date().toDateString();
  const key = `${req.ip}_${today}`;
  const count = rateLimitMap.get(key) || 0;
  res.json({ used: count, limit: 5 });
});

// Poll PicWish task result
async function pollResult(taskId, apiKey, retries = 15) {
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`https://techhk.aoscdn.com/api/tasks/visual/scale/${taskId}`, {
      headers: { "X-API-KEY": apiKey }
    });
    const data = await res.json();
    console.log("Poll response:", JSON.stringify(data));
    if (data?.data?.state === 1 && data?.data?.image) {
      return data.data.image;
    }
    if (data?.data?.state < 0) {
      throw new Error("PicWish task failed: " + JSON.stringify(data));
    }
  }
  throw new Error("PicWish timeout — took too long");
}

app.post("/api/upscale", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!checkRateLimit(req.ip)) {
      return res.status(429).json({
        error: "Daily free limit reached (5 images). Upgrade to Pro for unlimited!",
        upgradeRequired: true,
      });
    }
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const apiKey = process.env.PICWISH_API_KEY;
    const scale = parseInt(req.body.scale) || 2;
    console.log(`Upscaling with PicWish, scale=${scale}x...`);

    const imageBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append("image_file", imageBuffer, {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype,
    });
    form.append("sync", "0");
    form.append("scale", scale);

    // Step 1: Create task
    const createRes = await fetch("https://techhk.aoscdn.com/api/tasks/visual/scale", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, ...form.getHeaders() },
      body: form,
    });

    const createData = await createRes.json();
    console.log("Create task response:", JSON.stringify(createData));

    if (!createRes.ok || !createData?.data?.task_id) {
      throw new Error("PicWish task creation failed: " + JSON.stringify(createData));
    }

    const taskId = createData.data.task_id;

    // Step 2: Poll for result
    const outputUrl = await pollResult(taskId, apiKey);

    res.json({
      success: true,
      outputUrl: outputUrl,
      scale: scale,
      message: "Image upscaled successfully!",
    });

  } catch (err) {
    console.error("Upscale error:", err);
    res.status(500).json({ error: err.message || "Upscaling failed. Please try again." });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "UpscaleAI — PicWish" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`UpscaleAI backend running on port ${PORT}`));
