import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { rankThresholds } from '../utils/rank.js';

function groupRanks(thresholds) {
  const grouped = {};

  thresholds.forEach(({ rank, threshold }) => {
    const parts = rank.split(' ');
    const baseName = parts[0];
    const suffix = parts.slice(1).join(' ');

    if (!grouped[baseName]) grouped[baseName] = [];

    if (suffix) {
      grouped[baseName].push(`${suffix} - ${threshold}`);
    } else {
      grouped[baseName].push(`${threshold}`);
    }
  });

  return grouped;
}

export const data = new SlashCommandBuilder()
  .setName('rankinfo')
  .setDescription('Provides the rank thresholds for all ranks.');

export async function execute(interaction) {
  const rankInfoEmbed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Fumble Bot Rank Information')
    .setTimestamp();

  const groupedRanks = groupRanks(rankThresholds);

  for (const [rankName, values] of Object.entries(groupedRanks)) {
    rankInfoEmbed.addFields({
      name: rankName,
      value: values.join('\n'),
      inline: true
    });
  }

  await interaction.reply({ embeds: [rankInfoEmbed] });
}
