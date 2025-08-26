import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import User from '../models/User.js';

export const data = new SlashCommandBuilder()
    .setName('rankserv')
    .setDescription('Displays the leaderboard of all users by Elo.');
export async function execute(interaction) {
    // Get all users from the database, sorted by Elo in descending order
    const users = await User.find().sort({ elo: -1 });

    // If no users found, inform the user
    if (users.length === 0) {
        await interaction.reply({ content: "No users found in the database.", ephemeral: true });
        return;
    }

    // Prepare the leaderboard information
    const usersInfo = [];

    // Format each user's info for the leaderboard
    users.forEach((user, index) => {
        const userInfo = `${index + 1}. ${user.username} - ${user.elo} (${user.peakElo}) - ${user.rank}`;
        usersInfo.push(userInfo);
    });

    // Create an embed for the leaderboard
    const rankServEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Fumble Bot Leaderboard')
        .setDescription(usersInfo.join('\n'))
        .setTimestamp();

    // Send the embed
    await interaction.reply({ embeds: [rankServEmbed] });
}
