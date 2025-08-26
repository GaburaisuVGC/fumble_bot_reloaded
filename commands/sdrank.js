import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Server from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('sdrank')
    .setDescription('Displays the Elo ranking of registered users on this server.');
export async function execute(interaction) {
    const guildId = interaction.guildId;

    try {
        // Fetch the server document from the database
        const server = await Server.findOne({ discordId: guildId });

        if (!server || server.registeredUsers.length === 0) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Error')
                .setDescription('No registered users found for this server. Please register users with /register command.');

            return await interaction.reply({ embeds: [errorEmbed] });
        }

        // Sort users by Elo (descending) and then by GXE (descending)
        const sortedUsers = server.registeredUsers.sort((a, b) => {
            if (b.elo === a.elo) {
                return parseFloat(b.gxe) - parseFloat(a.gxe); // Sort by GXE if Elo is the same
            }
            return b.elo - a.elo; // Sort by Elo
        });

        // Build the ranking string
        let ranking = '';
        sortedUsers.forEach((user, index) => {
            ranking += `**${index + 1}.** ${user.username}: **${user.elo}** ELO, ${user.gxe}% GXE\n`;
        });

        // Create and send the embed with the ranking
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Elo Ranking of Registered Users')
            .setDescription(ranking)
            .setFooter({ text: 'Next update at 07:00 UTC+2 daily' })

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching server data:', error);
        await interaction.reply('There was an error fetching the server data. Please try again later.');
    }
}
