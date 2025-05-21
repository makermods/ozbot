const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

const FIXED_TIERS = {
  attack: [2, 4, 6, 8, 10, 12, 14],
  allStat: [1, 2, 3, 4, 5, 6, 7],
  boss: [2, 4, 6, 8, 10, 12, 14]
};

const LEVEL_BASED_TIERS = [
  { min: 0, max: 19, values: [1, 2, 3, 4, 5, 6, 7] },
  { min: 20, max: 39, values: [2, 4, 6, 8, 10, 12, 14] },
  { min: 40, max: 59, values: [3, 6, 9, 12, 15, 18, 21] },
  { min: 60, max: 79, values: [4, 8, 12, 16, 20, 24, 28] },
  { min: 80, max: 99, values: [5, 10, 15, 20, 25, 30, 35] },
  { min: 100, max: 119, values: [6, 12, 18, 24, 30, 36, 42] },
  { min: 120, max: 139, values: [7, 14, 21, 28, 35, 42, 49] },
  { min: 140, max: 159, values: [8, 16, 24, 32, 40, 48, 56] },
  { min: 160, max: 179, values: [9, 18, 27, 36, 45, 54, 63] },
  { min: 180, max: 199, values: [10, 20, 30, 40, 50, 60, 70] },
  { min: 200, max: 229, values: [11, 22, 33, 44, 55, 66, 77] },
  { min: 230, max: 999, values: [12, 24, 36, 48, 60, 72, 84] }
];

const MAGE_WEAPONS = ['wand', 'staff', 'shining rod', 'fan', 'cane', 'psy-limiter'];

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

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) {
      console.log(`getTier: value=${value} → tier=${i + 1} (threshold=${table[i]})`);
      return i + 1;
    }
  }
  return 0;
}

function getLevelBasedTierTable(level) {
  for (const range of LEVEL_BASED_TIERS) {
    if (level >= range.min && level <= range.max) return range.values;
  }
  return LEVEL_BASED_TIERS[0].values;
}

function getStatTierBreakdown(stats, main, sub, useMagic, equipLevel) {
  const breakdown = [];
  const levelBased = getLevelBasedTierTable(equipLevel);
  console.log(`[Tier Table for Level ${equipLevel}]`, levelBased);

  if (stats[main]) {
    console.log(`Checking ${main}: ${stats[main]} against`, levelBased);
    breakdown.push(`T${getTier(stats[main], levelBased)} (${main})`);
  }
  if (sub && stats[sub]) {
    console.log(`Checking ${sub}: ${stats[sub]} against`, levelBased);
    breakdown.push(`T${getTier(stats[sub], levelBased)} (${sub})`);
  }
  if (useMagic && stats.magic) breakdown.push(`T${getTier(stats.magic, FIXED_TIERS.attack)} (MATT)`);
  if (!useMagic && stats.attack) breakdown.push(`T${getTier(stats.attack, FIXED_TIERS.attack)} (ATK)`);
  if (stats.allStatPercent) breakdown.push(`T${getTier(stats.allStatPercent, FIXED_TIERS.allStat)} (All Stat%)`);
  if (stats.boss) breakdown.push(`T${getTier(stats.boss, FIXED_TIERS.boss)} (Boss)`);
  return breakdown;
}

async function extractStats(imageBuffer, isStarforced) {
  const image = await Jimp.read(imageBuffer);
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

  let equipLevel = 0;
  const manualInputRequired = [];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log('--- OCR TEXT ---\n' + lines.join('\n'));

  const parseStatLine = (line, key, isPercent = false) => {
    const totalMatch = line.match(/\+(\d+)/);
    const values = line.match(/\((.*?)\)/)?.[1]?.match(/\d+/g)?.map(Number) || [];

    if (['boss', 'allStatPercent'].includes(key)) {
      stats[key] = values[1] ?? 0;
      return;
    }

    if (!isStarforced) {
      stats[key] = values[1] ?? 0;
      return;
    }

    if (values.length === 3 && totalMatch) {
      const total = parseInt(totalMatch[1]);
      const [base, flame, enhancement] = values;

      if (base + flame + enhancement === total) {
        stats[key] = flame;
      } else {
        const correctedFlame = total - base - enhancement;
        if (correctedFlame >= 0 && correctedFlame <= 999) {
          stats[key] = correctedFlame;
        } else {
          stats[key] = 0;
          manualInputRequired.push(key);
        }
      }
    } else {
      stats[key] = 0;
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
    // 🔧 FIXED: Looser matching for REQ LEV
    else if (/REQ.*LEV.*[:\s]+([0-9]+)/i.test(line)) {
      equipLevel = parseInt(line.match(/REQ.*LEV.*[:\s]+([0-9]+)/i)[1]);
      console.log('[Parsed REQ LEV]', equipLevel);
    }
  }

  return { stats, manualInputRequired, equipLevel };
}

async function analyzeFlame(imageBuffer, mainStat, subStat, isStarforced) {
  const { stats, manualInputRequired, equipLevel } = await extractStats(imageBuffer, isStarforced);
  const useMagic = shouldUseMagicAttack(stats.weaponType);

  const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic);
  const tierBreakdown = getStatTierBreakdown(stats, mainStat, subStat, useMagic, equipLevel || 0);

  return {
    stats,
    flameScore,
    tiers: tierBreakdown,
    useMagic,
    mainStat,
    subStat,
    manualInputRequired
  };
}

module.exports = {
  analyzeFlame
};
