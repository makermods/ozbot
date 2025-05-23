// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const { processImage } = require('./ocr');
const { analyzeItem } = require('./analyzer');
const logger = require('./logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;

client.once(Events.ClientReady, () => {
  logger.log(`🟢 Bot ready: ${client.user.tag}`);
});

client.on(Events.MessageCreate, async message => {
  if (message.channel.id !== CHANNEL_ID || !message.attachments.size) return;

  const image = message.attachments.first();
  logger.log(`📷 Image received from ${message.author.tag}: ${image.url}`);

  try {
    const ocrText = await processImage(image.url);
    const analysis = await analyzeItem(ocrText);

    const flameStats = [];
    flameStats.push(`Main Stat: ${analysis.mainStatValue}`); // Always include main stat
    if (analysis.attValue > 0) flameStats.push(`ATT: ${analysis.attValue}`);
    if (analysis.mattValue > 0) flameStats.push(`MATT: ${analysis.mattValue}`);
    if (analysis.bossValue > 0) flameStats.push(`Boss: ${analysis.bossValue}%`);
    if (analysis.allStatValue > 0) flameStats.push(`All Stat: ${analysis.allStatValue}%`);

    const flameTiers = [];
    if (analysis.attValue > 0 && analysis.attTier > 0) flameTiers.push(`T${analysis.attTier} (ATT)`);
    if (analysis.mattValue > 0 && analysis.mattTier > 0) flameTiers.push(`T${analysis.mattTier} (MATT)`);
    if (analysis.bossValue > 0 && analysis.bossTier > 0) flameTiers.push(`T${analysis.bossTier} (Boss)`);
    if (analysis.allStatValue > 0 && analysis.allStatTier > 0) flameTiers.push(`T${analysis.allStatTier} (All Stat)`);
    if (analysis.mainStatValue > 0 && analysis.mainStatTier > 0) flameTiers.push(`T${analysis.mainStatTier} (${analysis.mainStat})`);

    const embed = new EmbedBuilder()
      .setTitle('🧾 Flame Analysis Result')
      .setColor(0x00AE86)
      .addFields(
        { name: 'Required Level', value: `${analysis.reqLevel}`, inline: true },
        { name: 'Main Stat', value: analysis.mainStat || 'Unknown', inline: true },
        { name: 'Starforced', value: `${analysis.starforced}`, inline: true },
        { name: 'Weapon Type', value: analysis.weaponType, inline: true },
        { name: '​', value: '​' },
        { name: '🔥 Flame Stats', value: flameStats.join('\n') },
        { name: '📊 Flame Tiers', value: flameTiers.length ? flameTiers.join('\n') : 'None' }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err) {
    logger.log(`❌ Error processing image: ${err.message}`);
    await message.reply('There was an error analyzing the image.');
  }
});

client.login(process.env.DISCORD_TOKEN);
