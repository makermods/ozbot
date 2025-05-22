// ✅ PATCHED flamescore.js WITH FULL TIER TABLES + LOGGING
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

const FIXED_TIERS = {
  allStat: [1, 2, 3, 4, 5, 6, 7],
  boss: [2, 4, 6, 8, 10, 12, 14]
};

const LEVEL_TIERS = [
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

const WEAPON_SETS = {
  genesis: /genesis/i,
  arcane: /arcane/i,
  absolab: /absolab/i
};

const MANUAL_LABELS = {
  STR: 'STR', DEX: 'DEX', INT: 'INT', LUK: 'LUK', HP: 'HP',
  attack: 'Attack Power', magic: 'Magic Attack',
  boss: 'Boss Damage', allStatPercent: 'All Stats %'
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getManualPromptLabel(statKey) {
  return MANUAL_LABELS[statKey] || statKey;
}

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) return i + 1;
  }
  return 0;
}

function isWeaponType(text) {
  return /claw|staff|sword|bow|dagger|rod|gun|cannon|knuckle|katana|polearm|spear|crossbow|weapon/i.test(text);
}

function detectWeaponSet(text) {
  for (const [set, regex] of Object.entries(WEAPON_SETS)) {
    if (regex.test(text)) return set;
  }
  return null;
}

function getLevelTierTable(level) {
  return LEVEL_TIERS.find(t => level >= t.min && level <= t.max)?.values || LEVEL_TIERS[0].values;
}

function shouldUseMagicAttack(type) {
  return /staff|wand|rod|shining rod|psy-limiter|fan|cane/i.test(type);
}

function calculateFlameScore(stats, main, sub, useMagic, isWeapon) {
  let score = 0;
  score += stats[main] || 0;
  if (sub) score += Math.floor((stats[sub] || 0) / 12);
  if (!isWeapon) {
    score += (useMagic ? stats.magic : stats.attack) * 3;
  }
  score += (stats.allStatPercent || 0) * 10;
  return score;
}

function getWeaponTier(flameVal, base, set) {
  const tables = {
    genesis: {
      172: [31, 46, 63, 83, 106], 237: [43, 63, 87, 114, 146],
      249: [45, 66, 91, 120, 154], 251: [46, 67, 92, 121, 155],
      255: [46, 68, 93, 123, 157], 304: [55, 81, 111, 146, 187],
      318: [58, 84, 116, 153, 196], 326: [59, 87, 119, 157, 201],
      337: [61, 89, 123, 162, 208], 340: [62, 90, 124, 163, 210],
      342: [62, 91, 125, 164, 211], 348: [63, 92, 127, 167, 214],
      400: [72, 106, 146, 192, 246], 406: [74, 108, 148, 195, 250]
    },
    arcane: {
      149: [27, 40, 55, 72, 92], 206: [38, 55, 75, 99, 127],
      216: [39, 58, 79, 104, 133], 218: [40, 58, 80, 105, 135],
      221: [40, 59, 81, 106, 136], 264: [48, 70, 96, 127, 163],
      276: [50, 73, 101, 133, 170], 283: [51, 75, 103, 136, 175],
      295: [54, 78, 108, 142, 182], 302: [55, 80, 110, 145, 186],
      347: [63, 92, 126, 167, 214], 353: [64, 94, 129, 170, 218]
    },
    absolab: {
      103: [16, 23, 32, 42, 53], 143: [22, 32, 44, 58, 74],
      150: [23, 33, 46, 60, 77], 151: [23, 34, 46, 61, 78],
      154: [24, 34, 47, 62, 79], 184: [28, 41, 56, 74, 95],
      192: [29, 43, 59, 77, 99], 197: [30, 44, 60, 79, 101],
      205: [31, 46, 63, 82, 106], 210: [32, 47, 64, 84, 108],
      241: [37, 54, 73, 97, 124], 245: [37, 54, 75, 98, 126]
    }
  };
  const setTable = tables[set];
  const row = setTable?.[parseInt(base)];
  if (!row) return null;
  for (let i = row.length - 1; i >= 0; i--) {
    if (flameVal >= row[i]) return `T${i + 3}`;
  }
  return 'T0';
}

function getStatTierBreakdown(stats, main, sub, useMagic, level, isWeapon, set, baseAtk) {
  const breakdown = [];
  const levelTiers = getLevelTierTable(level);

  if (stats[main]) breakdown.push(`T${getTier(stats[main], levelTiers)} (${main})`);
  if (sub && stats[sub]) breakdown.push(`T${getTier(stats[sub], levelTiers)} (${sub})`);

  if (isWeapon && baseAtk && set) {
    const atkVal = useMagic ? stats.magic : stats.attack;
    const tier = getWeaponTier(atkVal, baseAtk, set);
    if (tier) breakdown.push(`${tier} (${useMagic ? 'MATT' : 'ATK'})`);
  } else {
    if (useMagic && stats.magic) breakdown.push(`T${getTier(stats.magic, [2, 4, 6, 8, 10, 12, 14])} (MATT)`);
    if (!useMagic && stats.attack) breakdown.push(`T${getTier(stats.attack, [2, 4, 6, 8, 10, 12, 14])} (ATK)`);
  }

  if (stats.allStatPercent) breakdown.push(`T${getTier(stats.allStatPercent, FIXED_TIERS.allStat)} (All Stat%)`);
  if (stats.boss) breakdown.push(`T${getTier(stats.boss, FIXED_TIERS.boss)} (Boss)`);

  return breakdown;
}

module.exports = {
  analyzeFlame: async function(imageBuffer, mainStat, subStat, isStarforced) {
    const image = await Jimp.read(imageBuffer);
    image.resize(image.bitmap.width * 2, image.bitmap.height * 2).grayscale().contrast(0.5).normalize().brightness(0.1);

    const { data: { text } } = await Tesseract.recognize(await image.getBufferAsync(Jimp.MIME_PNG), 'eng');
    const stats = { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0, attack: 0, magic: 0, boss: 0, allStatPercent: 0, weaponType: '', baseAttack: 0 };
    let equipLevel = 0;
    const manualInputRequired = [];

    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const parseStatLine = (line, key) => {
      const match = line.match(/\+\d+[^\(]*\(([^)]+)\)/);
      if (!match) return;
      const values = match[1].match(/\d+/g)?.map(Number) || [];
      if (["boss", "allStatPercent"].includes(key)) {
        stats[key] = values[1] ?? 0;
        return;
      }
      if (values.length === 3 && isStarforced) {
        stats[key] = values[1];
      } else if (values.length === 2 && isStarforced) {
        stats[key] = 0;
      } else if (values.length >= 2) {
        stats[key] = values[1];
      } else {
        stats[key] = 0;
        manualInputRequired.push(key);
      }
    };

    for (const line of lines) {
      const lc = line.toLowerCase();
      if (lc.includes('str') && lc.includes('+')) parseStatLine(line, 'STR');
      else if (lc.includes('dex') && lc.includes('+')) parseStatLine(line, 'DEX');
      else if ((lc.includes('int') || lc.includes('nt')) && lc.includes('+')) parseStatLine(line, 'INT');
      else if (lc.includes('luk') && lc.includes('+')) parseStatLine(line, 'LUK');
      else if ((lc.includes('maxhp') || lc.includes('max hp')) && lc.includes('+')) parseStatLine(line, 'HP');
      else if (lc.includes('attack power') && lc.includes('+')) {
        parseStatLine(line, 'attack');
        const base = line.match(/\(?\s*(\d+)\s*\+\s*\d+/);
        if (base) {
          stats.baseAttack = parseInt(base[1]);
          log(`✅ [ATK] Extracted baseAttack: ${stats.baseAttack}`);
        }
      } else if (lc.includes('magic attack') && lc.includes('+')) {
        parseStatLine(line, 'magic');
        const base = line.match(/\(?\s*(\d+)\s*\+\s*\d+/);
        if (base) {
          stats.baseAttack = parseInt(base[1]);
          log(`✅ [MATT] Extracted baseAttack: ${stats.baseAttack}`);
        }
      } else if (lc.includes('all stats') && lc.includes('+')) parseStatLine(line, 'allStatPercent');
      else if (lc.includes('boss damage') && lc.includes('+')) parseStatLine(line, 'boss');
      else if (/Type: (.+)/i.test(line)) {
        const match = line.match(/Type: (.+)/i);
        if (match) stats.weaponType = match[1];
      } else if (/REQ.*LEV.*[:\s]+(\d+)/i.test(line)) {
        equipLevel = parseInt(line.match(/REQ.*LEV.*[:\s]+(\d+)/i)[1]);
      }
    }

    const useMagic = shouldUseMagicAttack(stats.weaponType);
    const isWeapon = isWeaponType(lines.join(' ') + ' ' + stats.weaponType);
    const weaponSet = detectWeaponSet(lines.join(' ') + ' ' + stats.weaponType);
    const manualSetPrompt = isWeapon && !weaponSet;

    const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic, isWeapon);
    const tiers = getStatTierBreakdown(stats, mainStat, subStat, useMagic, equipLevel, isWeapon, weaponSet, stats.baseAttack);

    return {
      stats,
      flameScore,
      tiers,
      useMagic,
      mainStat,
      subStat,
      manualInputRequired: manualInputRequired.map(key => ({ key, label: getManualPromptLabel(key) })),
      manualSetPrompt,
      weaponSetDetected: weaponSet
    };
  },
  getStatTierBreakdown,
  calculateFlameScore
};
