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

    const embed = new EmbedBuilder()
      .setTitle('🧾 Flame Analysis Result')
      .setDescription('Here are the extracted flame values and tiers:')
      .setColor(0x00AE86)
      .addFields(
        { name: 'Required Level', value: `${analysis.reqLevel}`, inline: true },
        { name: 'Main Stat', value: analysis.mainStat || 'Unknown', inline: true },
        { name: 'Starforced', value: `${analysis.starforced}`, inline: true },
        { name: 'Weapon Type', value: analysis.weaponType, inline: true },
        { name: '\u200B', value: '\u200B' }, // spacer
        { name: '🔥 Flame Stats', value: 
          `Main Stat: ${analysis.mainStatValue}\n` +
          `ATT: ${analysis.attValue}\n` +
          `MATT: ${analysis.mattValue}\n` +
          `Boss: ${analysis.bossValue}%\n` +
          `All Stat: ${analysis.allStatValue}%` },
        { name: '📊 Flame Tiers', value: 
          `T${analysis.attTier} (ATT)\n` +
          `T${analysis.mattTier} (MATT)\n` +
          `T${analysis.bossTier} (Boss)\n` +
          `T${analysis.allStatTier} (All Stat)\n` +
          `T${analysis.mainStatTier} (${analysis.mainStat})` }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

  } catch (err) {
    logger.log(`❌ Error processing image: ${err.message}`);
    await message.reply('There was an error analyzing the image.');
  }
});

client.login(process.env.DISCORD_TOKEN);
