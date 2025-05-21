const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

const FLAME_TIERS = {
  stat: [4, 8, 12, 16, 20, 24, 28],
  attack: [2, 4, 6, 8, 10, 12, 14],
  allStat: [1, 2, 3, 4, 5, 6, 7],
  boss: [2, 4, 6, 8, 10, 12, 14]
};

const MAGE_WEAPONS = ['wand', 'staff', 'shining rod', 'fan', 'cane', 'psy-limiter'];

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) return i + 1;
  }
  return 0;
}

function shouldUseMagicAttack(weaponType) {
  if (!weaponType) return false;
  return MAGE_WEAPONS.some(type => weaponType.toLowerCase().includes(type));
}

function calculateFlameScore(stats, main, sub, useMagic) {
  let score = 0;
  score += stats[main] || 0;
  if (sub) score += Math.floor((stats[sub] || 0) / 12);
  if (useMagic) score += (stats.magic || 0) * 3;
  else score += (stats.attack || 0) * 3;
  score += (stats.allStatPercent || 0) * 10;
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

async function extractStats(imageBuffer, isStarforced) {
  const image = await Jimp.read(imageBuffer);

  // Resize and preprocess
  image
    .resize(image.bitmap.width * 2, image.bitmap.height * 2)
    .grayscale()
    .contrast(0.5)
    .normalize()
    .brightness(0.1)
    .quality(100);

  const {
    data: { text }
  } = await Tesseract.recognize(await image.getBufferAsync(Jimp.MIME_PNG), 'eng', {
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:+%() ',
    psm: 6
  });

  const stats = {
    STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0,
    attack: 0, magic: 0, boss: 0, allStatPercent: 0,
    weaponType: '', baseAttack: null
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('--- OCR TEXT ---\n' + lines.join('\n'));

  const parseStatLine = (line, key, isPercent = false) => {
    const numbers = line.match(/\+(\d+)%?/g)?.map(n => parseInt(n.replace(/\+|%/g, ''))) || [];

    if (['boss', 'allStatPercent'].includes(key)) {
      // Always use second value if available
      stats[key] = numbers.length >= 2 ? numbers[1] : 0;
    } else {
      if (isStarforced) {
        if (numbers.length === 3) {
          stats[key] = numbers[1]; // middle value is flame
        } else {
          stats[key] = 0; // not a flame stat, only base + enhancement
        }
      } else {
        stats[key] = numbers[numbers.length - 1] ?? 0; // last value is flame
      }
    }
  };

  for (const line of lines) {
    if (/STR/i.test(line)) parseStatLine(line, 'STR');
    else if (/DEX/i.test(line)) parseStatLine(line, 'DEX');
    else if (/INT/i.test(line)) parseStatLine(line, 'INT');
    else if (/LUK/i.test(line)) parseStatLine(line, 'LUK');
    else if (/Max.*HP/i.test(line)) parseStatLine(line, 'HP');
    else if (/Attack Power|AllackPower/i.test(line)) parseStatLine(line, 'attack');
    else if (/Magic Attack/i.test(line)) parseStatLine(line, 'magic');
    else if (/All Stats/i.test(line)) parseStatLine(line, 'allStatPercent', true);
    else if (/Boss Damage|BoseDamage/i.test(line)) parseStatLine(line, 'boss', true);
    else if (/Type: (.+)/i.test(line)) {
      const match = line.match(/Type: (.+)/i);
      if (match) stats.weaponType = match[1];
    }
  }

  return stats;
}

async function analyzeFlame(imageBuffer, mainStat, subStat, isStarforced) {
  const stats = await extractStats(imageBuffer, isStarforced);
  const useMagic = shouldUseMagicAttack(stats.weaponType);

  const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic);
  const tierBreakdown = getStatTierBreakdown(stats, mainStat, subStat, useMagic);

  return {
    stats,
    flameScore,
    tiers: tierBreakdown,
    useMagic,
    mainStat,
    subStat
  };
}

module.exports = {
  analyzeFlame
};
