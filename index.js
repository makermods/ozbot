
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

    await interaction.update({
      content: 'What is your secondary stat?',
      components: [row]
    });

    setTimeout(async () => {
      const msg = await interaction.channel.messages.fetch(session.messageId);
      if (msg) await msg.delete();
    }, 2000);

  } else if (step === 'sub') {
    session.sub = value;
    session.step = 'starforced';

    const row = new ActionRowBuilder()
      .addComponents([
        new ButtonBuilder().setCustomId('starforced_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('starforced_no').setLabel('No').setStyle(ButtonStyle.Danger)
      ]);

    const prompt = await interaction.update({
      content: 'Is your item starforced?',
      components: [row]
    });

    session.starforcedPromptId = prompt.id;

      } else if (step === 'starforced') {
    const isStarforced = value === 'yes';
    session.step = 'analyzing';

    if (session.starforcedPromptId) {
      try {
        const msg = await interaction.channel.messages.fetch(session.starforcedPromptId);
        if (msg) await msg.delete();
      } catch {}
    }

    const imageBuffer = fs.readFileSync(session.imagePath);
    const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);

    if (result.manualSetPrompt) {
      const row = new ActionRowBuilder().addComponents([
        new ButtonBuilder().setCustomId('set_absolab').setLabel('AbsoLab').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_arcane').setLabel('Arcane').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('set_genesis').setLabel('Genesis').setStyle(ButtonStyle.Success),
      ]);

      const msg = await interaction.update({
        content: 'Manual weapon detection failed. Please select your weapon set to correctly calculate flame tier:',
        components: [row]
      });

      session.step = 'weaponSet';
      session.tempResult = result;
      session.tempMsgId = msg.id;
      return;
    }

    if (result.manualInputRequired.length > 0) {
      session.pendingStats = result.manualInputRequired;
      session.stats = result.stats;
      session.useMagic = result.useMagic;
      session.flameScore = result.flameScore;
      session.tiers = result.tiers;
      session.mainStat = result.mainStat;
      session.subStat = result.subStat;
      session.isStarforced = isStarforced;

      const current = session.pendingStats.shift();
      session.awaitingStat = current.key;

      const prompt = await interaction.update({
        content: `Auto-detection failed. Please enter the flame value for ${current.label}:`,
        components: []
      });

      session.promptId = prompt.id;
      return;
    }

    await postFlameResult(interaction, result, session, isStarforced);

  } else if (step === 'set') {
    const weaponSet = value;
    const imageBuffer = fs.readFileSync(session.imagePath);
    const result = await analyzeFlame(imageBuffer, session.main, session.sub, true);
    result.weaponSetDetected = weaponSet;

    try {
      const m = await interaction.channel.messages.fetch(session.tempMsgId);
      if (m) await m.delete();
    } catch {}

    await postFlameResult(interaction, result, session, true);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!userSessions.has(message.author.id)) return;
  const session = userSessions.get(message.author.id);
  if (!session.awaitingStat) return;

  const value = parseInt(message.content);
  if (!isNaN(value)) {
    session.stats[session.awaitingStat] = value;
    setTimeout(() => message.delete().catch(() => {}), 2000);

    if (session.pendingStats.length > 0) {
      const current = session.pendingStats.shift();
      session.awaitingStat = current.key;
      const prompt = await message.channel.send(`Auto-detection failed. Please enter the flame value for ${current.label}:`);
      setTimeout(() => prompt.delete().catch(() => {}), 2000);
    } else {
      session.awaitingStat = null;
      const result = {
        stats: session.stats,
        flameScore: session.flameScore,
        tiers: session.tiers,
        useMagic: session.useMagic,
        mainStat: session.mainStat,
        subStat: session.subStat
      };
      const fakeInteraction = {
        channel: message.channel,
        reply: (options) => message.channel.send(options)
      };
      await postFlameResult(fakeInteraction, result, session, session.isStarforced);
    }
  }
});

async function postFlameResult(interaction, result, session, isStarforced) {
  const { stats, tiers, flameScore, mainStat, subStat, useMagic } = result;

  const statLine = `Main Stat: ${stats[mainStat]} | Sub Stat: ${stats[subStat]}` +
    `${useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent} | Boss Damage: ${stats.boss}%`;

  const tierLine = tiers.join(', ');
  const scoreLine = `**Flame Score:** ${flameScore} (${mainStat})`;

  const reply = await interaction.reply({
    content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`,
    ephemeral: false
  });

  setTimeout(async () => {
    try {
      const msg = await interaction.channel.messages.fetch(reply.id);
      if (msg) await msg.delete();
      const userMsg = await interaction.channel.messages.fetch(session.originalImageId);
      if (userMsg) await userMsg.delete();
    } catch {}

    if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
    userSessions.delete(interaction.user.id);
  }, 30000);
}

client.login(process.env.DISCORD_TOKEN);
