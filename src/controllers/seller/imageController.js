const sharp = require('sharp');
const { uploadProductImage } = require('../../config/cloudinary');
const { generateBlurhash } = require('../../utils/blurhash');

exports.uploadProductImage = async (req, res) => {
  try {
    const buffer = req?.file?.buffer;
    if (!buffer) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required.',
        error: 'IMAGE_REQUIRED',
      });
    }

    const meta = await sharp(buffer).metadata();
    const result = await uploadProductImage(buffer, {
      publicId: `prod_${req.user._id}_${Date.now()}`,
    });

    const [thumb, medium, large] = result.eager || [];
    const { data: rawPixels, info } = await sharp(buffer)
      .resize(32, 32, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const blurhash = await generateBlurhash(rawPixels, info.width, info.height);

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: result.secure_url,
        thumbnail: thumb?.secure_url || result.secure_url,
        medium: medium?.secure_url || result.secure_url,
        large: large?.secure_url || result.secure_url,
        publicId: result.public_id,
        blurhash,
        width: meta.width || null,
        height: meta.height || null,
        format: 'webp',
        size: result.bytes || null,
      },
    });
  } catch (error) {
    console.error('Image upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Image upload failed. Please try again.',
      error: 'UPLOAD_FAILED',
    });
  }
};
