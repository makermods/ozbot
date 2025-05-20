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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const imageCache = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.attachments.size) return;

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

  const reply = await message.reply({
    content: 'What is your **main stat**?',
    components: [mainStatRow]
  });

  setTimeout(() => {
    message.delete().catch(() => {});
    reply.delete().catch(() => {});
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

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

    await interaction.reply({
      content: 'What is your **secondary stat**?',
      components: [secondaryStatRow],
      ephemeral: true
    });
  }

  if (type === 'secondary') {
    const mainStat = main;
    const subStat = sub;
    const imageBuffer = imageCache.get(interaction.user.id);

    if (!imageBuffer) {
      return interaction.reply({
        content: 'No image found. Please upload an item image first.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: false });

    const result = await analyzeFlame(imageBuffer, mainStat, subStat);

    const s = result.stats;
    const useMagic = result.useMagic;

    // Flame Stats Block
    const statLine = [
      `Main Stat: ${s[mainStat] || 0}`,
      `Sub Stat: ${s[subStat] || 0}`,
      useMagic ? `MATT: ${s.magic || 0}` : `ATK: ${s.attack || 0}`,
      `All Stat%: ${s.allStatPercent || 0}`,
    ];
    if (s.boss) statLine.push(`Boss: ${s.boss}%`);

    // Flame Tier Block
    const tierLine = result.tiers.join(', ');

    const reply = await interaction.editReply({
      content:
`**Flame Stats:**  
${statLine.join('  ')}

**Flame Tier:**  
${tierLine}

**Flame Score:**  
${result.flameScore} (${mainStat})${result.enhanced ? ' (Enhanced ⭐)' : ''}`
    });

    imageCache.delete(interaction.user.id);

    setTimeout(() => {
      interaction.fetchReply().then(m => m.delete().catch(() => {})).catch(() => {});
    }, 60 * 1000);
  }
});

client.login(process.env.DISCORD_TOKEN);
