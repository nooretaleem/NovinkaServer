const multer = require('multer');

const storage = multer.memoryStorage();

const allowedMimes = [
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/acad', 'image/vnd.dwg'
];

const fileFilter = (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type.'), false);
    }
};

const docUpload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

module.exports = docUpload;
