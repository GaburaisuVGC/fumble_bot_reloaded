import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import Server, { isOrganizer, isBotOwner } from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('unregister')
    .setDescription('Delete your Showdown username from the server.')
    .addStringOption(option => option.setName('username')
        .setDescription('The Showdown username to delete.')
        .setRequired(true));
export async function execute(interaction) {
    const username = interaction.options.getString('username');
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    try {
        // Fetch the server document from the database
        let server = await Server.findOne({ discordId: guildId });

        // trim the username (only alphanumeric characters, no spaces, dots, underscores or any other special characters, every character will be undercase)
        const trimmedUsername = username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        if (!server || !server.registeredUsers.find(user => user.username.toLowerCase() === trimmedUsername)) {
            // If the server doesn't exist or the username is not registered
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Error')
                .setDescription(`The Showdown username **${trimmedUsername}** is not registered on this server.`);

            return await interaction.reply({ embeds: [errorEmbed] });
        }

        // Find the user discordId associated with the username
        const registeredUser = server.registeredUsers.find(user => user.username.toLowerCase() === trimmedUsername);
        if (!registeredUser) {
            throw new Error('Registered user not found.');
        }
        const registeredUserId = registeredUser.discordId;

        // Check permissions
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const organizer = await isOrganizer(guildId, userId);
        const botOwner = isBotOwner(userId);

        if (userId !== registeredUserId && !isAdmin && !organizer && !botOwner) {
            return interaction.reply({
                content: "🚫 You cannot unregister someone else's Showdown account unless you are an organizer, admin, or bot owner.",
                ephemeral: true
            });
        }

        // Remove the user from the registeredUsers array
        server.registeredUsers = server.registeredUsers.filter(user => user.username.toLowerCase() !== trimmedUsername);

        // Save the changes to the database
        await server.save();

        // Respond with a confirmation embed
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Showdown Username Unregistered')
            .setDescription(`The Showdown username **${trimmedUsername}** has been successfully unregistered from this server.`);

        await interaction.reply({ embeds: [embed] });
        console.log(`User Showdown username unregistered from server ${guildId}`);
    } catch (error) {
        console.error('Error unregistering Showdown username:', error);
        await interaction.reply('There was an error unregistering the Showdown username. Please try again later.');
    }
}
