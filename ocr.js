const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const TEMP_IMAGE_PATH = path.join(__dirname, 'temp_image.png');

async function downloadImage(url, outputPath) {
  const response = await axios({ url, responseType: 'arraybuffer' });
  fs.writeFileSync(outputPath, response.data);
}

async function preprocessImage(inputPath) {
  const image = await Jimp.read(inputPath);
  image
    .resize(800, Jimp.AUTO)         // Resize for consistency
    .grayscale()                    // Convert to grayscale
    .contrast(0.5)                  // Enhance contrast
    .normalize()                    // Normalize light/dark areas
    .write(inputPath);             // Overwrite input
}

async function processImage(imageUrl) {
  try {
    logger.log(`⬇️ Downloading image: ${imageUrl}`);
    await downloadImage(imageUrl, TEMP_IMAGE_PATH);

    logger.log(`🧪 Preprocessing image`);
    await preprocessImage(TEMP_IMAGE_PATH);

    logger.log(`🔍 Performing OCR`);
    const { data: { text } } = await Tesseract.recognize(TEMP_IMAGE_PATH, 'eng', {
      logger: m => logger.log(`[Tesseract] ${m.status}`)
    });

    logger.log(`🧾 OCR Text:\n${text}`);
    return text;
  } catch (error) {
    logger.log(`❌ OCR error: ${error.message}`);
    throw error;
  } finally {
    // Clean up temp file
    if (fs.existsSync(TEMP_IMAGE_PATH)) fs.unlinkSync(TEMP_IMAGE_PATH);
  }
}

module.exports = { processImage };
