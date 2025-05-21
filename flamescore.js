const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

const FIXED_TIERS = {
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

const WEAPON_TIER_TABLES = {
  absolab: {
    103: [16, 23, 32, 42, 53],
    143: [22, 32, 44, 58, 74],
    150: [23, 33, 46, 60, 77],
    151: [23, 34, 46, 61, 78],
    154: [24, 34, 47, 62, 79],
    184: [28, 41, 56, 74, 95],
    192: [29, 43, 59, 77, 99],
    197: [30, 44, 60, 79, 101],
    205: [31, 46, 63, 82, 106],
    210: [32, 47, 64, 84, 108],
    241: [37, 54, 73, 97, 124],
    245: [37, 54, 75, 98, 126]
  },
  arcane: {
    149: [27, 40, 55, 72, 92],
    206: [38, 55, 75, 99, 127],
    216: [39, 58, 79, 104, 133],
    218: [40, 58, 80, 105, 135],
    221: [40, 59, 81, 106, 136],
    264: [48, 70, 96, 127, 163],
    276: [50, 73, 101, 133, 170],
    283: [51, 75, 103, 136, 175],
    295: [54, 78, 108, 142, 182],
    302: [55, 80, 110, 145, 186],
    347: [63, 92, 126, 167, 214],
    353: [64, 94, 129, 170, 218]
  },
  genesis: {
    172: [31, 46, 63, 83, 106],
    237: [43, 63, 87, 114, 146],
    249: [45, 66, 91, 120, 154],
    251: [46, 67, 92, 121, 155],
    255: [46, 68, 93, 123, 157],
    304: [55, 81, 111, 146, 187],
    318: [58, 84, 116, 153, 196],
    326: [59, 87, 119, 157, 201],
    337: [61, 89, 123, 162, 208],
    340: [62, 90, 124, 163, 210],
    342: [62, 91, 125, 164, 211],
    348: [63, 92, 127, 167, 214],
    400: [72, 106, 146, 192, 246],
    406: [74, 108, 148, 195, 250]
  }
};

function shouldUseMagicAttack(weaponType) {
  if (!weaponType) return false;
  return MAGE_WEAPONS.some(type => weaponType.toLowerCase().includes(type));
}

function isWeaponItem(typeText) {
  return /claw|sword|bow|dagger|staff|rod|gun|cannon|knuckle|katana|polearm|spear|crossbow|weapon/i.test(typeText);
}

function detectWeaponSet(text) {
  const lc = text.toLowerCase();
  if (lc.includes('absolab')) return 'absolab';
  if (lc.includes('arcane umbra')) return 'arcane';
  if (lc.includes('genesis')) return 'genesis';
  return null;
}

function getWeaponTier(flame, baseAtk, category) {
  const table = WEAPON_TIER_TABLES[category];
  if (!table || !table[baseAtk]) return null;

  const tiers = table[baseAtk];
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (flame >= tiers[i]) return `T${i + 3}`;
  }
  return 'T0';
}

function calculateFlameScore(stats, main, sub, useMagic, isWeapon) {
  let score = 0;
  score += stats[main] || 0;
  if (sub) score += Math.floor((stats[sub] || 0) / 12);
  if (!isWeapon) {
    if (useMagic) score += (stats.magic || 0) * 3;
    else score += (stats.attack || 0) * 3;
  }
  score += (stats.allStatPercent || 0) * 10;
  return score;
}

function getLevelBasedTierTable(level) {
  for (const range of LEVEL_BASED_TIERS) {
    if (level >= range.min && level <= range.max) return range.values;
  }
  return LEVEL_BASED_TIERS[0].values;
}

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) return i + 1;
  }
  return 0;
}

function getStatTierBreakdown(stats, main, sub, useMagic, equipLevel, isWeapon, weaponBase, weaponSet) {
  const breakdown = [];
  const levelBased = getLevelBasedTierTable(equipLevel);

  if (stats[main]) breakdown.push(`T${getTier(stats[main], levelBased)} (${main})`);
  if (sub && stats[sub]) breakdown.push(`T${getTier(stats[sub], levelBased)} (${sub})`);

  if (isWeapon && weaponSet && weaponBase) {
    const flameVal = useMagic ? stats.magic : stats.attack;
    const tier = getWeaponTier(flameVal, weaponBase, weaponSet);
    if (tier) breakdown.push(`${tier} (${useMagic ? 'MATT' : 'ATK'})`);
  } else {
    if (useMagic && stats.magic) breakdown.push(`T${getTier(stats.magic, [2, 4, 6, 8, 10, 12, 14])} (MATT)`);
    if (!useMagic && stats.attack) breakdown.push(`T${getTier(stats.attack, [2, 4, 6, 8, 10, 12, 14])} (ATK)`);
  }

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

  const { data: { text } } = await Tesseract.recognize(await image.getBufferAsync(Jimp.MIME_PNG), 'eng', {
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:+%() ',
    psm: 6
  });

  const stats = {
    STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0,
    attack: 0, magic: 0, boss: 0, allStatPercent: 0,
    weaponType: '', baseAttack: 0
  };

  let equipLevel = 0;
  const manualInputRequired = [];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log('--- OCR TEXT ---\n' + lines.join('\n'));

  const fullText = lines.join(' ').toLowerCase();

  const parseStatLine = (line, key) => {
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
        if (key === 'attack' || key === 'magic') stats.baseAttack = base;
      } else {
        const corrected = total - base - enhancement;
        if (corrected >= 0 && corrected <= 999) {
          stats[key] = corrected;
          if (key === 'attack' || key === 'magic') stats.baseAttack = base;
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
    else if (/All Stats/i.test(line)) parseStatLine(line, 'allStatPercent');
    else if (/Boss Damage|BoseDamage/i.test(line)) parseStatLine(line, 'boss');
    else if (/Type: (.+)/i.test(line)) {
      const match = line.match(/Type: (.+)/i);
      if (match) stats.weaponType = match[1];
    }
    else if (/REQ.*LEV.*[:\s]+([0-9]+)/i.test(line)) {
      equipLevel = parseInt(line.match(/REQ.*LEV.*[:\s]+([0-9]+)/i)[1]);
      console.log('[Parsed REQ LEV]', equipLevel);
    }
  }

  const isWeapon = isWeaponItem(stats.weaponType || '');
  const weaponSet = detectWeaponSet(fullText);

  return { stats, manualInputRequired, equipLevel, isWeapon, weaponSet };
}

async function analyzeFlame(imageBuffer, mainStat, subStat, isStarforced) {
  const { stats, manualInputRequired, equipLevel, isWeapon, weaponSet } = await extractStats(imageBuffer, isStarforced);
  const useMagic = shouldUseMagicAttack(stats.weaponType);

  const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic, isWeapon);
  const tierBreakdown = getStatTierBreakdown(stats, mainStat, subStat, useMagic, equipLevel, isWeapon, stats.baseAttack, weaponSet);

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
