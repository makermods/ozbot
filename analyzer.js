// analyzer.js
const {
  MAIN_STAT_KEYWORDS,
  ALL_WEAPON_KEYWORDS,
  MATT_WEAPON_KEYWORDS,
  MAIN_STAT_TIERS,
  BOSS_TIERS,
  ALL_STAT_TIERS,
  ABSOLAB_TIERS,
  ARCANE_TIERS,
  GENESIS_TIERS
} = require('./tierTables');
const logger = require('./logger');

function getTier(value, table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i]) return i + 3;
  }
  return 0;
}

function getMainStatTier(reqLevel, flameValue) {
  for (const tier of MAIN_STAT_TIERS) {
    if (reqLevel >= tier.min && reqLevel <= tier.max) {
      return getTier(flameValue, tier.values) - 2;
    }
  }
  return 0;
}

function getAttackTier(base, flame, categoryTable) {
  const tierValues = categoryTable[base];
  if (!tierValues) return 0;
  return getTier(flame, tierValues);
}

function analyzeItem(text) {
  logger.log('📊 Starting item analysis');

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lowerText = text.toLowerCase();

  let reqLevel = 0;
  for (const line of lines) {
    const match = line.match(/REQ LEV[\s:]*([0-9]+)/i);
    if (match) {
      reqLevel = parseInt(match[1]);
      break;
    }
  }
  logger.log(`📌 Required Level: ${reqLevel}`);

  let mainStat = null;
  for (const [stat, keywords] of Object.entries(MAIN_STAT_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      mainStat = stat;
      break;
    }
  }
  logger.log(`⭐ Main Stat: ${mainStat || 'Not found'}`);

  const statLines = lines.filter(line => /\+?\d+(\s*\/\s*\d+){1,2}/.test(line));
  const starforced = statLines.some(line => line.split('/').length === 3);
  logger.log(`🌟 Starforced: ${starforced}`);

  const isWeapon = ALL_WEAPON_KEYWORDS.some(k => text.includes(k));
  logger.log(`🗡️ Is Weapon: ${isWeapon}`);

  let isMATTWeapon = false;
  if (isWeapon) {
    isMATTWeapon = MATT_WEAPON_KEYWORDS.some(k => text.includes(k));
    logger.log(`🔮 Magic Weapon: ${isMATTWeapon}`);
  }

  let itemCategory = null;
  if (text.includes('AbsoLab')) itemCategory = 'Absolab';
  else if (text.includes('Arcane')) itemCategory = 'Arcane';
  else if (text.includes('Genesis')) itemCategory = 'Genesis';
  logger.log(`🏷️ Item Category: ${itemCategory || 'Unknown'}`);

  let mainStatValue = 0;
  let attValue = 0, baseAtt = 0;
  let mattValue = 0, baseMatt = 0;
  let bossValue = 0;
  let allStatValue = 0;

  for (const line of statLines) {
    if (mainStat && line.includes(mainStat)) {
      const nums = line.match(/\d+/g).map(Number);
      if (starforced && nums.length === 3) mainStatValue = nums[1];
      else if (!starforced && nums.length === 2) mainStatValue = nums[1];
    }
    if (line.toLowerCase().includes('attack') && !line.toLowerCase().includes('magic')) {
      const nums = line.match(/\d+/g).map(Number);
      if (starforced && nums.length === 3) [baseAtt, attValue] = [nums[0], nums[1]];
      else if (!starforced && nums.length === 2) [baseAtt, attValue] = [nums[0], nums[1]];
    }
    if (line.toLowerCase().includes('magic') || line.toLowerCase().includes('m.att')) {
      const nums = line.match(/\d+/g).map(Number);
      if (starforced && nums.length === 3) [baseMatt, mattValue] = [nums[0], nums[1]];
      else if (!starforced && nums.length === 2) [baseMatt, mattValue] = [nums[0], nums[1]];
    }
    if (line.toLowerCase().includes('boss')) {
      const nums = line.match(/\d+/g).map(Number);
      if (nums.length >= 2) bossValue = nums[1];
      else if (nums.length === 1) bossValue = nums[0];
    }
    if (line.toLowerCase().includes('all')) {
      const nums = line.match(/\d+/g).map(Number);
      if (nums.length >= 2) allStatValue = nums[1];
      else if (nums.length === 1) allStatValue = nums[0];
    }
  }

  const mainStatTier = getMainStatTier(reqLevel, mainStatValue);
  const bossTier = getTier(bossValue, BOSS_TIERS);
  const allStatTier = getTier(allStatValue, ALL_STAT_TIERS);

  let attTier = '-';
  let mattTier = '-';
  if (isWeapon && itemCategory) {
    if (!isMATTWeapon && attValue && baseAtt) {
      const table = itemCategory === 'Absolab' ? ABSOLAB_TIERS : itemCategory === 'Arcane' ? ARCANE_TIERS : GENESIS_TIERS;
      attTier = getAttackTier(baseAtt, attValue, table);
    } else if (isMATTWeapon && mattValue && baseMatt) {
      const table = itemCategory === 'Absolab' ? ABSOLAB_TIERS : itemCategory === 'Arcane' ? ARCANE_TIERS : GENESIS_TIERS;
      mattTier = getAttackTier(baseMatt, mattValue, table);
    }
  }

  return {
    reqLevel,
    mainStat,
    starforced,
    isWeapon,
    isMATTWeapon,
    itemCategory,
    mainStatValue,
    attValue,
    baseAtt,
    attTier,
    mattValue,
    baseMatt,
    mattTier,
    bossValue,
    bossTier,
    allStatValue,
    allStatTier,
    mainStatTier,
    weaponType: isWeapon ? (isMATTWeapon ? 'MATT' : 'ATT') : 'No'
  };
}

module.exports = { analyzeItem };
