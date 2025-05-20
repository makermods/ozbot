require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require('discord.js');
const { analyzeFlame } = require('./flamescore.js');
const fetch = require('node-fetch');

const ALLOWED_CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const imageCache = new Map();
const messageCache = new Map(); // to track messages per user

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (
    message.author.bot ||
    !message.attachments.size ||
    message.channel.id !== ALLOWED_CHANNEL_ID
  ) return;

  const imageAttachment = message.attachments.first();
  const imageBuffer = await fetch(imageAttachment.url)
    .then(res => res.arrayBuffer())
    .then(buf => Buffer.from(buf));

  imageCache.set(message.author.id, imageBuffer);

  const mainStatRow = new ActionRowBuilder().addComponents(
    ['STR', 'DEX', 'INT', 'LUK', 'HP'].map(stat =>
      new ButtonBuilder()
        .setCustomId(`main_${stat}`)
        .setLabel(stat)
        .setStyle(ButtonStyle.Primary)
    )
  );

  const prompt = await message.reply({
    content: 'What is your **main stat**?',
    components: [mainStatRow]
  });

  messageCache.set(message.author.id, {
    uploadMessage: message,
    mainPrompt: prompt,
    secondaryPrompt: null
  });

  // Image message will be deleted later, after processing
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) return;

  const [type, main, sub] = interaction.customId.split('_');

  if (type === 'main') {
    const secondaryStatRow = new ActionRowBuilder().addComponents(
      ['STR', 'DEX', 'INT', 'LUK'].map(stat =>
        new ButtonBuilder()
          .setCustomId(`secondary_${main}_${stat}`)
          .setLabel(stat)
          .setStyle(ButtonStyle.Secondary)
      )
    );

    // Delete main prompt message
    const cached = messageCache.get(interaction.user.id);
    if (cached?.mainPrompt) {
      cached.mainPrompt.delete().catch(() => {});
    }

    const reply = await interaction.reply({
      content: 'What is your **secondary stat**?',
      components: [secondaryStatRow],
      fetchReply: true
    });

    if (cached) cached.secondaryPrompt = reply;
  }

  if (type === 'secondary') {
    const mainStat = main;
    const subStat = sub;
    const imageBuffer = imageCache.get(interaction.user.id);

    const cached = messageCache.get(interaction.user.id);
    if (cached?.secondaryPrompt) {
      cached.secondaryPrompt.delete().catch(() => {});
    }

    if (!imageBuffer) {
      return interaction.reply({
        content: 'No image found. Please upload an item image first.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const result = await analyzeFlame(imageBuffer, mainStat, subStat);
    const s = result.stats;

    const statLine = [
      `Main Stat: ${s[mainStat] || 0}`,
      `Sub Stat: ${s[subStat] || 0}`,
      result.useMagic ? `MATT: ${s.magic || 0}` : `ATK: ${s.attack || 0}`,
      `All Stat%: ${s.allStatPercent || 0}`
    ];
    if (s.boss) statLine.push(`Boss: ${s.boss}%`);

    const tierLine = result.tiers.join(', ');

    const finalReply = await interaction.editReply({
      content:
`**Flame Stats:**  
${statLine.join('  ')}

**Flame Tier:**  
${tierLine}

**Flame Score:**  
${result.flameScore} (${mainStat})${result.enhanced ? ' (Enhanced ⭐)' : ''}`
    });

    setTimeout(() => {
      finalReply.delete().catch(() => {});
      if (cached?.uploadMessage) cached.uploadMessage.delete().catch(() => {});
    }, 60_000);

    imageCache.delete(interaction.user.id);
    messageCache.delete(interaction.user.id);
  }
});

client.login(process.env.DISCORD_TOKEN);
