const Tesseract = require('tesseract.js');

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

async function extractStats(imageBuffer, starforced) {
  const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
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

  const extractFlame = (line) => {
    const values = line.match(/\d+/g)?.map(Number);
    if (!values) return 0;
    if (starforced && values.length === 3) return values[1]; // middle = flame
    if (!starforced && values.length === 2) return values[1]; // second = flame
    return 0;
  };

  for (let line of lines) {
    line = line.trim();

    if (/STR[: ]?\+?/i.test(line)) result.stats.STR = extractFlame(line);
    if (/DEX[: ]?\+?/i.test(line)) result.stats.DEX = extractFlame(line);
    if (/INT[: ]?\+?/i.test(line)) result.stats.INT = extractFlame(line);
    if (/LUK[: ]?\+?/i.test(line)) result.stats.LUK = extractFlame(line);
    if (/HP[: ]?\+?/i.test(line)) result.stats.HP = extractFlame(line);
    if (/Attack Power|ower/i.test(line)) result.stats.attack = extractFlame(line);
    if (/Magic Attack/i.test(line)) result.stats.magic = extractFlame(line);
    if (/All Stats?:?\s*\+?\d+%/i.test(line)) result.stats.allStatPercent = extractFlame(line);
    if (/Boss Damage|amage/i.test(line)) result.stats.boss = extractFlame(line);

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

async function analyzeFlame(imageBuffer, mainStat, subStat, starforced) {
  const ocrResult = await extractStats(imageBuffer, starforced);
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
    subStat,
    starforced
  };
}

module.exports = {
  analyzeFlame
};
