import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import Server from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('removeorganizer')
    .setDescription('Remove a user from tournament organizers.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to remove from organizers.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guildId;

    try {
        let server = await Server.findOne({ discordId: guildId });
        if (!server || !server.organizers.includes(targetUser.id)) {
            await interaction.reply({
                content: `${targetUser.username} is not an organizer on this server.`,
                ephemeral: true
            });
            return;
        }

        server.organizers = server.organizers.filter(id => id !== targetUser.id);
        await server.save();

        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Organizer Removed')
            .setDescription(`${targetUser.username} has been removed from tournament organizers.`);

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error removing organizer:', error);
        await interaction.reply({
            content: 'There was an error removing the organizer. Please try again later.',
            ephemeral: true
        });
    }
}
