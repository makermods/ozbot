const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

const FLAME_TIERS = {
  stat: [4, 8, 12, 16, 20, 24, 28],
  attack: [2, 4, 6, 8, 10, 12, 14],
  allStat: [1, 2, 3, 4, 5, 6, 7],
  boss: [2, 4, 6, 8, 10, 12, 14],
};

const MAGE_WEAPONS = [
  'wand', 'staff', 'shining rod', 'fan', 'cane', 'psy-limiter'
];

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) return i + 1;
  }
  return 0;
}

async function isEnhanced(imageBuffer) {
  const image = await Jimp.read(imageBuffer);

  // ✅ Full-width crop along top to capture yellow/gray stars
  const starRegion = image.clone().crop(10, 0, image.bitmap.width - 20, 55);

  let yellowStars = 0;
  let greyStars = 0;

  starRegion.scan(0, 0, starRegion.bitmap.width, starRegion.bitmap.height, function (x, y, idx) {
    const red = this.bitmap.data[idx];
    const green = this.bitmap.data[idx + 1];
    const blue = this.bitmap.data[idx + 2];

    if (red > 200 && green > 200 && blue < 100) yellowStars++;
    else if (red < 150 && green < 150 && blue < 150) greyStars++;
  });

  return yellowStars > greyStars;
}

async function extractStats(imageBuffer) {
  const image = await Jimp.read(imageBuffer);

  // ✅ Wider and taller crop to capture stat names + values fully
  const cropped = image.clone().crop(30, 230, image.bitmap.width - 60, 280);

  cropped
    .grayscale()
    .contrast(1)
    .normalize()
    .resize(cropped.bitmap.width * 2, cropped.bitmap.height * 2);

  const processedBuffer = await cropped.getBufferAsync(Jimp.MIME_PNG);

  const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng', {
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:+% ',
  });

  console.log('--- OCR TEXT ---');
  console.log(text);

  const result = {
    stats: {
      STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0,
      attack: 0, magic: 0, boss: 0, allStatPercent: 0,
      weaponType: '', baseAttack: null
    },
    text: text
  };

  const lines = text.split('\n');

  for (let line of lines) {
    line = line.trim();

    if (/STR[: ]?\+?(\d+)/i.test(line)) result.stats.STR = parseInt(line.match(/STR[: ]?\+?(\d+)/i)[1]);
    if (/DEX[: ]?\+?(\d+)/i.test(line)) result.stats.DEX = parseInt(line.match(/DEX[: ]?\+?(\d+)/i)[1]);
    if (/INT[: ]?\+?(\d+)/i.test(line)) result.stats.INT = parseInt(line.match(/INT[: ]?\+?(\d+)/i)[1]);
    if (/LUK[: ]?\+?(\d+)/i.test(line)) result.stats.LUK = parseInt(line.match(/LUK[: ]?\+?(\d+)/i)[1]);
    if (/HP[: ]?\+?(\d+)/i.test(line)) result.stats.HP = parseInt(line.match(/HP[: ]?\+?(\d+)/i)[1]);

    if (/Attack Power[: ]?\+?(\d+)/i.test(line) || /ower[: ]?\+?(\d+)/i.test(line))
      result.stats.attack = parseInt((line.match(/Attack Power[: ]?\+?(\d+)/i) || line.match(/ower[: ]?\+?(\d+)/i))[1]);

    if (/Magic Attack[: ]?\+?(\d+)/i.test(line)) result.stats.magic = parseInt(line.match(/Magic Attack[: ]?\+?(\d+)/i)[1]);

    if (/All Stats[: ]?\+?(\d+)%/i.test(line) || /All Stat[: ]?\+?(\d+)%/i.test(line))
      result.stats.allStatPercent = parseInt((line.match(/All Stats[: ]?\+?(\d+)%/i) || line.match(/All Stat[: ]?\+?(\d+)%/i))[1]);

    if (/Boss Damage[: ]?\+?(\d+)%/i.test(line) || /amage[: ]?\+?(\d+)%/i.test(line))
      result.stats.boss = parseInt((line.match(/Boss Damage[: ]?\+?(\d+)%/i) || line.match(/amage[: ]?\+?(\d+)%/i))[1]);

    // Loose match for weapon type
    const typeMatch = line.match(/Type[: ]?(.+)/i) || line.match(/ype[: ]?(.+)/i);
    if (typeMatch) result.stats.weaponType = typeMatch[1];
  }

  console.log('Detected weapon type:', result.stats.weaponType);

  return result;
}

function shouldUseMagicAttack(weaponType) {
  if (!weaponType) return false;
  return MAGE_WEAPONS.some(type => weaponType.toLowerCase().includes(type));
}

function calculateFlameScore(stats, main, sub, useMagic) {
  let score = 0;
  score += stats[main] || 0;
  if (sub) score += Math.floor((stats[sub] || 0) / 12);
  score += (useMagic ? stats.magic : stats.attack) * 3;
  score += stats.allStatPercent * 10;
  return score;
}

function getStatTierBreakdown(stats, main, sub, useMagic) {
  const breakdown = [];

  if (stats[main]) breakdown.push(`T${getTier(stats[main], FLAME_TIERS.stat)} (${main})`);
  if (sub && stats[sub]) breakdown.push(`T${getTier(stats[sub], FLAME_TIERS.stat)} (${sub})`);
  if (useMagic && stats.magic) breakdown.push(`T${getTier(stats.magic, FLAME_TIERS.attack)} (MATT)`);
  if (!useMagic && stats.attack) breakdown.push(`T${getTier(stats.attack, FLAME_TIERS.attack)} (ATK)`);
  if (stats.allStatPercent) breakdown.push(`T${getTier(stats.allStatPercent, FLAME_TIERS.allStat)} (All Stat%)`);
  if (stats.boss) breakdown.push(`T${getTier(stats.boss, FLAME_TIERS.boss)} (Boss)`);

  return breakdown;
}

async function analyzeFlame(imageBuffer, mainStat, subStat) {
  const enhanced = await isEnhanced(imageBuffer);
  const ocrResult = await extractStats(imageBuffer);
  const stats = ocrResult.stats;
  const useMagic = shouldUseMagicAttack(stats.weaponType);

  const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic);
  const tierBreakdown = getStatTierBreakdown(stats, mainStat, subStat, useMagic);

  return {
    enhanced,
    flameScore,
    useMagic,
    stats,
    tiers: tierBreakdown,
    mainStat,
    subStat
  };
}

module.exports = {
  analyzeFlame
};
