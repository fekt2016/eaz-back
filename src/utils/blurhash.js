const { encode } = require('blurhash');

const convertRGBtoRGBA = (rgb, width, height) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
};

const generateBlurhash = async (pixels, width, height) => {
  try {
    const rgbaPixels =
      pixels.length === width * height * 3
        ? convertRGBtoRGBA(pixels, width, height)
        : pixels;

    return encode(new Uint8ClampedArray(rgbaPixels), width, height, 4, 4);
  } catch (error) {
    console.error('Blurhash generation error:', error?.message);
    return null;
  }
};

module.exports = {
  generateBlurhash,
};
