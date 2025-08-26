import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Server from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('unregister')
    .setDescription('Delete your Showdown username from the server.')
    .addStringOption(option => option.setName('username')
        .setDescription('The Showdown username to delete.')
        .setRequired(true));
export async function execute(interaction) {
    const username = interaction.options.getString('username');
    const guildId = interaction.guildId;

    try {
        // Fetch the server document from the database
        let server = await Server.findOne({ discordId: guildId });

        if (!server || !server.registeredUsers.find(user => user.username === username)) {
            // If the server doesn't exist or the username is not registered
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Error')
                .setDescription(`The Showdown username **${username}** is not registered on this server.`);

            return await interaction.reply({ embeds: [errorEmbed] });
        }

        // Remove the user from the registeredUsers array
        server.registeredUsers = server.registeredUsers.filter(user => user.username !== username);

        // Save the changes to the database
        await server.save();

        // Respond with a confirmation embed
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Showdown Username Unregistered')
            .setDescription(`The Showdown username **${username}** has been successfully unregistered from this server.`);

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unregistering Showdown username:', error);
        await interaction.reply('There was an error unregistering the Showdown username. Please try again later.');
    }
}
