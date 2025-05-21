require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  Partials
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { analyzeFlame } = require('./flamescore');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const statOptions = ['STR', 'DEX', 'INT', 'LUK', 'HP'];
const userSessions = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.channel.id !== CHANNEL_ID) return;
  if (!message.attachments.size) return;

  const attachment = message.attachments.first();
  if (!attachment.contentType?.startsWith('image/')) return;

  const imagePath = path.join(__dirname, 'temp', `${Date.now()}-${attachment.name}`);
  const res = await fetch(attachment.url);
  const buffer = Buffer.from(await res.arrayBuffer());

  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, buffer);

  const row = new ActionRowBuilder()
    .addComponents(statOptions.map(stat =>
      new ButtonBuilder()
        .setCustomId(`main_${stat}`)
        .setLabel(stat)
        .setStyle(ButtonStyle.Primary)
    ));

  const prompt = await message.reply({
    content: 'What is your main stat?',
    components: [row]
  });

  userSessions.set(message.author.id, {
    step: 'main',
    imagePath,
    messageId: prompt.id,
    originalImageId: message.id
  });

  setTimeout(() => {
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }, 60000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const session = userSessions.get(interaction.user.id);
  if (!session) return;

  const customId = interaction.customId;

  if (customId.startsWith('main_')) {
    const value = customId.split('_')[1];
    session.main = value;
    session.step = 'sub';

    const row = new ActionRowBuilder()
      .addComponents(statOptions.filter(s => s !== value).map(stat =>
        new ButtonBuilder()
          .setCustomId(`sub_${stat}`)
          .setLabel(stat)
          .setStyle(ButtonStyle.Secondary)
      ));

    await interaction.update({
      content: 'What is your secondary stat?',
      components: [row],
      ephemeral: false
    });

  } else if (customId.startsWith('sub_')) {
    const value = customId.split('_')[1];
    session.sub = value;
    session.step = 'starforced';

    const row = new ActionRowBuilder()
      .addComponents([
        new ButtonBuilder().setCustomId('starforced_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('starforced_no').setLabel('No').setStyle(ButtonStyle.Danger)
      ]);

    await interaction.update({
      content: 'Is your item starforced?',
      components: [row],
      ephemeral: false
    });

  } else if (customId.startsWith('starforced_')) {
    const value = customId.split('_')[1];
    const isStarforced = value === 'yes';

    try {
      await interaction.deferUpdate();

      const imageBuffer = fs.readFileSync(session.imagePath);
      const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);

      const { stats, tiers, flameScore, mainStat, subStat, useMagic } = result;

      const statLine = `Main Stat: ${stats[mainStat]} | Sub Stat: ${stats[subStat]}` +
        `${useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent} | Boss Damage: ${stats.boss}%`;

      const tierLine = tiers.join(', ');
      const scoreLine = `**Flame Score:** ${flameScore} (${mainStat})`;

      const followup = await interaction.followUp({
        content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`,
        ephemeral: false
      });

      setTimeout(async () => {
        try {
          const msg = await interaction.channel.messages.fetch(followup.id);
          if (msg) await msg.delete();
          const userMsg = await interaction.channel.messages.fetch(session.originalImageId);
          if (userMsg) await userMsg.delete();
        } catch (err) {
          console.warn('Cleanup error:', err.message);
        }

        if (fs.existsSync(session.imagePath)) {
          fs.unlinkSync(session.imagePath);
        }
        userSessions.delete(interaction.user.id);
      }, 60000);

    } catch (err) {
      console.error('Error during starforced interaction:', err);
      try {
        await interaction.followUp({
          content: '⚠️ Something went wrong while analyzing the image. Please try again.',
          ephemeral: true
        });
      } catch (e) {
        console.warn('Follow-up error:', e.message);
      }

      if (fs.existsSync(session.imagePath)) {
        fs.unlinkSync(session.imagePath);
      }
      userSessions.delete(interaction.user.id);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
