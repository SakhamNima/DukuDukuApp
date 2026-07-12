const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { nanoid } = require('nanoid');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    cb(null, `${Date.now()}_${nanoid(8)}${ext}`);
  },
});

const ALLOWED = /^(image|video)\//;

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES) || 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.test(file.mimetype)) return cb(new Error('Only image/video uploads are allowed'));
    cb(null, true);
  },
});

function publicUrlFor(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

module.exports = { upload, UPLOAD_DIR, publicUrlFor };
