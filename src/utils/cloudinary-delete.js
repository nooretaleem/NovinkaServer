// src/utils/cloudinary-delete.js
const cloudinary = require('../config/cloudinary');

/**
 * Delete an image asset from Cloudinary by its public_id
 * @param {String} publicId - The Cloudinary public_id to delete
 * @returns {Promise<Object|null>} Cloudinary destroy response result or null
 */
const deleteFromCloudinary = async (publicId) => {
    if (!publicId || typeof publicId !== 'string' || !publicId.trim()) {
        return null;
    }

    try {
        const result = await cloudinary.uploader.destroy(publicId.trim());
        return result;
    } catch (error) {
        // Resolve cleanly if not found or already deleted; throw unexpected errors
        if (error && (error.http_code === 404 || error.message?.includes('not found'))) {
            return { result: 'not found' };
        }
        console.error(`Failed to delete Cloudinary asset [${publicId}]:`, error);
        throw error;
    }
};

module.exports = deleteFromCloudinary;
