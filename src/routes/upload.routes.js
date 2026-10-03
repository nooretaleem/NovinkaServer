const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer to save temporarily
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // We will store them in server/public/uploads/quotes to ensure they are accessible
        const dest = path.join(__dirname, '../../public/uploads/quotes/temp');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

router.post('/', upload.array('files', 1), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const attachments = req.files.map(file => ({
            fileName: file.originalname,
            fileUrl: `/uploads/quotes/temp/${file.filename}`, // Relative path for public access
            fileType: file.mimetype,
            fileSize: file.size
        }));

        res.status(200).json({ success: true, attachments });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ success: false, message: 'File upload failed' });
    }
});

module.exports = router;
