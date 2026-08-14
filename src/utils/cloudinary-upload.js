// src/utils/cloudinary-upload.js
const cloudinary = require('../config/cloudinary');

/**
 * Upload a Multer memoryStorage file object or Buffer to Cloudinary
 * @param {Object|Buffer} fileOrBuffer - Multer file object (containing .buffer) or binary Buffer
 * @param {String} [folder='novinka'] - Optional Cloudinary folder name
 * @returns {Promise<Object>} Cloudinary upload response metadata
 */
const uploadToCloudinary = (fileOrBuffer, folder = 'novinka') => {
    return new Promise((resolve, reject) => {
        if (!fileOrBuffer) {
            return reject(new Error('No file or buffer provided for Cloudinary upload.'));
        }

        const buffer = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fileOrBuffer.buffer;

        if (!buffer) {
            return reject(new Error('Invalid file object: buffer is missing.'));
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'image'
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                if (!result) {
                    return reject(new Error('Cloudinary upload returned an empty result.'));
                }

                resolve({
                    secure_url: result.secure_url,
                    public_id: result.public_id,
                    width: result.width,
                    height: result.height,
                    format: result.format,
                    bytes: result.bytes
                });
            }
        );

        uploadStream.end(buffer);
    });
};

module.exports = uploadToCloudinary;