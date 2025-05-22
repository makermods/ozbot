// ✅ FULLY PATCHED index.js WITH TIMESTAMPED DEBUG LOGS
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
const { analyzeFlame, getStatTierBreakdown, calculateFlameScore } = require('./flamescore');

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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

client.once('ready', () => {
  log(`Logged in as ${client.user.tag}`);
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

    const prompt = await interaction.channel.send({
      content: 'What is your secondary stat?',
      components: [row]
    });

    session.messageId = prompt.id;

  } else if (step === 'sub') {
    session.sub = value;
    session.step = 'starforced';

    const row = new ActionRowBuilder()
      .addComponents([
        new ButtonBuilder().setCustomId('starforced_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('starforced_no').setLabel('No').setStyle(ButtonStyle.Danger)
      ]);

    const prompt = await interaction.channel.send({
      content: 'Is your item starforced?',
      components: [row]
    });

    session.messageId = prompt.id;

  } else if (step === 'starforced') {
    await interaction.deferReply({ ephemeral: false });

    const isStarforced = value === 'yes';
    const imageBuffer = fs.readFileSync(session.imagePath);
    const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);

    log(`Flame analysis complete: weaponSetDetected = ${result.weaponSetDetected}, manualSetPrompt = ${result.manualSetPrompt}`);

    if (result.manualInputRequired.length > 0) {
      session.result = result;
      session.pendingInputs = result.manualInputRequired;
      session.manualStats = {};
      const stat = result.manualInputRequired[0];
      session.step = 'manual';
      session.currentManual = stat;

      const promptMsg = await interaction.followUp({
        content: `Auto-detection failed. Please enter the flame value for **${stat.label}**:`,
        ephemeral: false
      });

      session.lastPromptId = promptMsg.id;
      return;
    }

    if (result.manualSetPrompt) {
      session.result = result;
      session.step = 'weaponSet';

      const row = new ActionRowBuilder()
        .addComponents([
          new ButtonBuilder().setCustomId('weaponset_absolab').setLabel('AbsoLab').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('weaponset_arcane').setLabel('Arcane').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('weaponset_genesis').setLabel('Genesis').setStyle(ButtonStyle.Success)
        ]);

      const prompt = await interaction.followUp({
        content: 'Automatic weapon set detection failed. Please select your weapon set:',
        components: [row],
        ephemeral: false
      });

      session.messageId = prompt.id;
      return;
    }

    // ✅ Recalculate tier and score after auto-detected weapon set
    const stats = result.stats;
    const mainStat = result.mainStat;
    const subStat = result.subStat;
    const useMagic = result.useMagic;
    const baseAtk = stats.baseAttack;
    const weaponSet = result.weaponSetDetected;
    const isWeapon = true;

    const updatedTiers = getStatTierBreakdown(
      stats, mainStat, subStat, useMagic,
      stats.levelRequirement || 0,
      isWeapon,
      weaponSet,
      baseAtk
    );

    const flameScore = calculateFlameScore(stats, mainStat, subStat, useMagic, isWeapon);

    log(`Posting result: set=${weaponSet}, baseAtk=${baseAtk}, score=${flameScore}`);

    const statLine = `Main Stat: ${stats[mainStat]} | Sub Stat: ${stats[subStat]}` +
      `${useMagic ? ` | MATT: ${stats.magic}` : ` | ATK: ${stats.attack}`} | All Stat%: ${stats.allStatPercent} | Boss Damage: ${stats.boss}%`;

    const tierLine = updatedTiers.join(', ');
    const scoreLine = `**Flame Score:** ${flameScore} (${mainStat})`;

    const resultMsg = await interaction.followUp({
      content: `**Flame Stats:**
${statLine}

**Flame Tier:**
${tierLine}

${scoreLine}`,
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

client.login(process.env.DISCORD_TOKEN);
