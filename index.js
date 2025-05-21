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

function calculateFlameScore(stats, main, sub, useMagic) {
  let score = 0;
  score += stats[main] || 0;
  if (sub) score += Math.floor((stats[sub] || 0) / 12);
  if (useMagic) score += (stats.magic || 0) * 3;
  else score += (stats.attack || 0) * 3;
  score += (stats.allStatPercent || 0) * 10;
  return score;
}

function getStatTierBreakdown(stats, main, sub, useMagic) {
  const tiers = [];
  const getTier = (value, table) => {
    for (let i = table.length - 1; i >= 0; i--) {
      if (value >= table[i]) return i + 1;
    }
    return 0;
  };

  const FLAME_TIERS = {
    stat: [4, 8, 12, 16, 20, 24, 28],
    attack: [2, 4, 6, 8, 10, 12, 14],
    allStat: [1, 2, 3, 4, 5, 6, 7],
    boss: [2, 4, 6, 8, 10, 12, 14]
  };

  if (stats[main]) tiers.push(`T${getTier(stats[main], FLAME_TIERS.stat)} (${main})`);
  if (sub && stats[sub]) tiers.push(`T${getTier(stats[sub], FLAME_TIERS.stat)} (${sub})`);
  if (useMagic && stats.magic) tiers.push(`T${getTier(stats.magic, FLAME_TIERS.attack)} (MATT)`);
  if (!useMagic && stats.attack) tiers.push(`T${getTier(stats.attack, FLAME_TIERS.attack)} (ATK)`);
  if (stats.allStatPercent) tiers.push(`T${getTier(stats.allStatPercent, FLAME_TIERS.allStat)} (All Stat%)`);
  if (stats.boss) tiers.push(`T${getTier(stats.boss, FLAME_TIERS.boss)} (Boss)`);
  return tiers;
}

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

    session.starforcedPromptId = interaction.message.id;

  } else if (customId.startsWith('starforced_')) {
    const value = customId.split('_')[1];
    const isStarforced = value === 'yes';

    try {
      await interaction.deferUpdate();
      await interaction.message.delete();

      const imageBuffer = fs.readFileSync(session.imagePath);
      const result = await analyzeFlame(imageBuffer, session.main, session.sub, isStarforced);
      const { stats, tiers, flameScore, mainStat, subStat, useMagic, manualInputRequired } = result;

      if (manualInputRequired.length > 0) {
        session.stats = stats;
        session.manualQueue = [...manualInputRequired];
        session.manualIndex = 0;
        session.isStarforced = isStarforced;

        const askNextStat = async () => {
          const stat = session.manualQueue[session.manualIndex];
          await interaction.followUp({
            content: `Auto-detection failed. Please enter the flame value for **${stat}**:`,
            ephemeral: true
          });

          const collector = interaction.channel.createMessageCollector({
            filter: m => m.author.id === interaction.user.id,
            max: 1,
            time: 30000
          });

          collector.on('collect', async msg => {
            const value = parseInt(msg.content.trim());
            if (isNaN(value) || value < 0 || value > 999) {
              await msg.reply({ content: '❌ Invalid value. Please enter a number between 0 and 999.', ephemeral: true });
              return;
            }

            session.stats[stat] = value;
            session.manualIndex++;

            if (session.manualIndex < session.manualQueue.length) {
              askNextStat(); // Ask for next
            } else {
              const useMagic = session.stats.weaponType && ['wand', 'staff', 'shining rod', 'fan', 'cane', 'psy-limiter'].some(w => session.stats.weaponType.toLowerCase().includes(w));
              const flameScore = calculateFlameScore(session.stats, session.main, session.sub, useMagic);
              const tiers = getStatTierBreakdown(session.stats, session.main, session.sub, useMagic);

              const statLine = `Main Stat: ${session.stats[session.main]} | Sub Stat: ${session.stats[session.sub]}` +
                `${useMagic ? ` | MATT: ${session.stats.magic}` : ` | ATK: ${session.stats.attack}`} | All Stat%: ${session.stats.allStatPercent} | Boss Damage: ${session.stats.boss}%`;

              const tierLine = tiers.join(', ');
              const scoreLine = `**Flame Score:** ${flameScore} (${session.main})`;

              const resultMsg = await msg.reply({
                content: `**Flame Stats:**\n${statLine}\n\n**Flame Tier:**\n${tierLine}\n\n${scoreLine}`
              });

              setTimeout(async () => {
                try {
                  await resultMsg.delete();
                  await msg.delete();
                  const userMsg = await interaction.channel.messages.fetch(session.originalImageId);
                  if (userMsg) await userMsg.delete();
                } catch {}
                if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
                userSessions.delete(interaction.user.id);
              }, 60000);
            }
          });

          collector.on('end', collected => {
            if (collected.size === 0) {
              interaction.followUp({ content: '⏱️ Timed out waiting for input.', ephemeral: true });
              if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
              userSessions.delete(interaction.user.id);
            }
          });
        };

        await askNextStat();
        return;
      }

      // Normal output (no manual input needed)
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
        } catch {}

        if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
        userSessions.delete(interaction.user.id);
      }, 60000);

    } catch (err) {
      console.error('Error during starforced interaction:', err);
      try {
        await interaction.followUp({
          content: '⚠️ Something went wrong while analyzing the image. Please try again.',
          ephemeral: true
        });
      } catch {}
      if (fs.existsSync(session.imagePath)) fs.unlinkSync(session.imagePath);
      userSessions.delete(interaction.user.id);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
