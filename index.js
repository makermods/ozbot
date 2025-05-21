// This updated index.js implements message deletion timing:
// - Initial image: 30s after result
// - Stat selection prompts: deleted immediately
// - Manual stat prompts & replies: deleted 2s after input
// - Result message: 30s after it's shown

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
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const session = userSessions.get(interaction.user.id);
  if (!session) return;

  const [step, value] = interaction.customId.split('_');

  // Delete the previous prompt immediately
  try {
    const msg = await interaction.channel.messages.fetch(interaction.message.id);
    if (msg) await msg.delete();
  } catch {}

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

    const newPrompt = await interaction.channel.send({
      content: 'What is your secondary stat?',
      components: [row]
    });

    session.messageId = newPrompt.id;

  } else if (step === 'sub') {
    session.sub = value;
    session.step = 'starforced';

    const row = new ActionRowBuilder()
      .addComponents([
        new ButtonBuilder().setCustomId('starforced_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('starforced_no').setLabel('No').setStyle(ButtonStyle.Danger)
      ]);

    const newPrompt = await interaction.channel.send({
      content: 'Is your item starforced?',
      components: [row]
    });

    session.messageId = newPrompt.id;

  } else if (step === 'starforced') {
    await interaction.deferReply({ ephemeral: false });

    const isStarforced = value === 'yes';
    const imageBuffer = fs.readFileSync(session.imagePath);
    const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);

    const { stats, tiers, flameScore, mainStat, subStat, useMagic, manualInputRequired } = result;

    if (manualInputRequired.length > 0) {
      session.result = result;
      session.pendingInputs = manualInputRequired;
      session.manualStats = {};
      const stat = manualInputRequired[0];
      session.step = 'manual';
      session.currentManual = stat;

      const promptMsg = await interaction.followUp({
        content: `Auto-detection failed. Please enter the flame value for **${stat.label}**:`,
        ephemeral: false
      });

      session.lastPromptId = promptMsg.id;
      return;
    }

    const statLine = `Main Stat: ${stats[mainStat]} | Sub Stat: ${stats[subStat]}` +
      `${useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent} | Boss Damage: ${stats.boss}%`;

    const tierLine = tiers.join(', ');
    const scoreLine = `**Flame Score:** ${flameScore} (${mainStat})`;

    const resultMsg = await interaction.followUp({
      content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`,
      ephemeral: false
    });

    setTimeout(async () => {
      try {
        const msg = await interaction.channel.messages.fetch(resultMsg.id);
        if (msg) await msg.delete();
        const userMsg = await interaction.channel.messages.fetch(session.originalImageId);
        if (userMsg) await userMsg.delete();
      } catch {}
      if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
      userSessions.delete(interaction.user.id);
    }, 30000);
  }
});

client.on(Events.MessageCreate, async (message) => {
  const session = userSessions.get(message.author.id);
  if (!session || session.step !== 'manual') return;

  const statKey = session.currentManual.key;
  const value = parseInt(message.content);

  if (isNaN(value)) {
    await message.reply({ content: 'Please enter a valid number.', ephemeral: true });
    return;
  }

  session.manualStats[statKey] = value;
  const nextIndex = session.pendingInputs.findIndex(s => s.key === statKey) + 1;

  // Delete manual prompt and user input after 2 seconds
  setTimeout(async () => {
    try {
      const prompt = await message.channel.messages.fetch(session.lastPromptId);
      if (prompt) await prompt.delete();
      await message.delete();
    } catch {}
  }, 2000);

  if (nextIndex < session.pendingInputs.length) {
    const nextStat = session.pendingInputs[nextIndex];
    session.currentManual = nextStat;

    const nextPrompt = await message.channel.send({
      content: `Please enter the flame value for **${nextStat.label}**:`
    });

    session.lastPromptId = nextPrompt.id;
  } else {
    const result = session.result;
    const stats = { ...result.stats, ...session.manualStats };
    const statLine = `Main Stat: ${stats[result.mainStat]} | Sub Stat: ${stats[result.subStat]}` +
      `${result.useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent} | Boss Damage: ${stats.boss}%`;

    const tierLine = result.tiers.join(', ');
    const scoreLine = `**Flame Score:** ${result.flameScore} (${result.mainStat})`;

    const reply = await message.channel.send({
      content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`
    });

    setTimeout(async () => {
      try {
        const userMsg = await message.channel.messages.fetch(session.originalImageId);
        if (userMsg) await userMsg.delete();
        if (reply) await reply.delete();
      } catch {}
      if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
      userSessions.delete(message.author.id);
    }, 30000);
  }
});

client.login(process.env.DISCORD_TOKEN);
