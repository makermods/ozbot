const Tesseract = require('tesseract.js');

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
  const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:+%() '
  });

  const stats = {
    STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0,
    attack: 0, magic: 0, boss: 0, allStatPercent: 0,
    weaponType: '', baseAttack: null
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('--- OCR TEXT ---\n' + lines.join('\n'));

  for (const line of lines) {
    const parseStatLine = (label, key) => {
      const regex = new RegExp(`${label}.*\\+(\\d+)\\s*(\\+\\d+)?\\s*\\+(\\d+)`);
      const match = line.match(regex);
      if (match) stats[key] = parseInt(isStarforced ? match[2]?.replace('+', '') : match[1]);
    };

    if (/STR/i.test(line)) parseStatLine('STR', 'STR');
    else if (/DEX/i.test(line)) parseStatLine('DEX', 'DEX');
    else if (/INT/i.test(line)) parseStatLine('INT', 'INT');
    else if (/LUK/i.test(line)) parseStatLine('LUK', 'LUK');
    else if (/HP/i.test(line)) parseStatLine('MaxHP', 'HP');
    else if (/Attack Power/i.test(line)) parseStatLine('Attack Power', 'attack');
    else if (/Magic Attack/i.test(line)) parseStatLine('Magic Attack', 'magic');
    else if (/All Stats.*\+(\d+)%/.test(line)) stats.allStatPercent = parseInt(line.match(/All Stats.*\+(\d+)%/)[1]);
    else if (/Boss Damage.*\+(\d+)%/.test(line)) stats.boss = parseInt(line.match(/Boss Damage.*\+(\d+)%/)[1]);
    else if (/Type: (.+)/i.test(line)) stats.weaponType = line.match(/Type: (.+)/i)[1];
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
