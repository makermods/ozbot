require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require('discord.js');
const { analyzeFlame } = require('./flamescore');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const statOptions = ['STR', 'DEX', 'INT', 'LUK', 'HP'];
const userSessions = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || String(message.channel.id) !== String(CHANNEL_ID)) return;
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

  const prompt = await message.reply({ content: 'What is your main stat?', components: [row] });

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

  const [step, value] = interaction.customId.split('_');

  if (step === 'main') {
    session.main = value;
    session.step = 'sub';

    const row = new ActionRowBuilder()
      .addComponents(statOptions.filter(s => s !== value).map(stat =>
        new ButtonBuilder()
          .setCustomId(`sub_${stat}`)
          .setLabel(stat)
          .setStyle(ButtonStyle.Secondary)
      ));

    await interaction.update({ content: 'What is your secondary stat?', components: [row] });
  }

  else if (step === 'sub') {
    session.sub = value;
    session.step = 'starforced';

    const row = new ActionRowBuilder()
      .addComponents([
        new ButtonBuilder().setCustomId('starforced_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('starforced_no').setLabel('No').setStyle(ButtonStyle.Danger)
      ]);

    await interaction.update({ content: 'Is your item starforced?', components: [row] });
  }

  else if (step === 'starforced') {
    const isStarforced = value === 'yes';

    // ⏳ Defer the interaction to avoid timeout errors
    await interaction.deferUpdate();

    const imageBuffer = fs.readFileSync(session.imagePath);
    const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);

    const { stats, tiers, flameScore, mainStat, subStat, useMagic } = result;

    const statLine = `Main Stat: ${stats[mainStat]} | Sub Stat: ${stats[subStat]}` +
                     `${useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent}`;
    const tierLine = tiers.join(', ');
    const scoreLine = `**Flame Score:** ${flameScore} (${mainStat})`;

    // 📤 Send the final result as a new message
    const replyMessage = await interaction.channel.send({
      content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`
    });

    // 🧹 Delete everything after 60 seconds
    setTimeout(async () => {
      try {
        const msg = await interaction.channel.messages.fetch(replyMessage.id);
        if (msg) await msg.delete();
        const userMsg = await interaction.channel.messages.fetch(session.originalImageId);
        if (userMsg) await userMsg.delete();
      } catch {}
    }, 60000);

    fs.unlinkSync(session.imagePath);
    userSessions.delete(interaction.user.id);
  }
});

client.login(process.env.DISCORD_TOKEN);
