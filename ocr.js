// ocr.js
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const logger = require('./logger');

async function processImage(imageUrl) {
  logger.log(`🔍 Processing image: ${imageUrl}`);

  const image = await Jimp.read(imageUrl);

  // Preprocess the image to improve OCR accuracy
  image
    .greyscale()
    .contrast(1)
    .normalize()
    .resize(image.bitmap.width * 2, image.bitmap.height * 2);

  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

  const result = await Tesseract.recognize(buffer, 'eng', {
    logger: m => logger.log(`🔠 OCR Engine: ${m.status} - ${m.progress}`),
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+%():.- ',
    preserve_interword_spaces: 1
  });

  const text = result.data.text;
  logger.log(`🧾 OCR Text:\n${text}`);
  return text;
}

module.exports = { processImage };

