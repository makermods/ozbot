
const Tesseract = require('tesseract.js');

// Typical flame tier values for level 160+ gear
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

async function extractStats(imageBuffer) {
  const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:+% ()'
  });

  const result = {
    stats: {
      STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0,
      attack: 0, magic: 0, boss: 0, allStatPercent: 0,
      weaponType: ''
    },
    text: text
  };

  const lines = text.split('\n');

  for (let line of lines) {
    line = line.trim();

    if (/STR\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.STR = parseInt(line.match(/STR\s*[:=]\s*\+(\d+)/i)[1]);
    if (/DEX\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.DEX = parseInt(line.match(/DEX\s*[:=]\s*\+(\d+)/i)[1]);
    if (/INT\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.INT = parseInt(line.match(/INT\s*[:=]\s*\+(\d+)/i)[1]);
    if (/LUK\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.LUK = parseInt(line.match(/LUK\s*[:=]\s*\+(\d+)/i)[1]);
    if (/HP\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.HP = parseInt(line.match(/HP\s*[:=]\s*\+(\d+)/i)[1]);

    if (/Attack Power\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.attack = parseInt(line.match(/Attack Power\s*[:=]\s*\+(\d+)/i)[1]);
    if (/Magic Attack\s*[:=]\s*\+(\d+)/i.test(line)) result.stats.magic = parseInt(line.match(/Magic Attack\s*[:=]\s*\+(\d+)/i)[1]);
    if (/All Stats\s*[:=]\s*\+(\d+)%/i.test(line)) result.stats.allStatPercent = parseInt(line.match(/All Stats\s*[:=]\s*\+(\d+)%/i)[1]);
    if (/Boss Damage\s*[:=]?\s*\+(\d+)%/i.test(line)) result.stats.boss = parseInt(line.match(/Boss Damage\s*[:=]?\s*\+(\d+)%/i)[1]);
    if (/Type\s*[:=]\s*(.+)/i.test(line)) result.stats.weaponType = line.match(/Type\s*[:=]\s*(.+)/i)[1];
  }

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
  if (useMagic) score += stats.magic * 3;
  else score += stats.attack * 3;
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

async function analyzeFlame(imageBuffer, mainStat, subStat, isStarforced) {
  const ocrResult = await extractStats(imageBuffer);
  const stats = ocrResult.stats;
  const useMagic = shouldUseMagicAttack(stats.weaponType);

  const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic);
  const tierBreakdown = getStatTierBreakdown(stats, mainStat, subStat, useMagic);

  return {
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
