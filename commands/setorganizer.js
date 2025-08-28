import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import Server from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('setorganizer')
    .setDescription('Add a user as tournament organizer.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to set as organizer.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guildId;

    try {
        let server = await Server.findOne({ discordId: guildId });
        if (!server) {
            server = new Server({
                discordId: guildId,
                organizers: [targetUser.id]
            });
        } else {
            if (!server.organizers.includes(targetUser.id)) {
                server.organizers.push(targetUser.id);
            }
        }

        await server.save();

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Organizer Added')
            .setDescription(`${targetUser.username} has been added as a tournament organizer.`);

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error setting organizer:', error);
        await interaction.reply({
            content: 'There was an error setting the organizer. Please try again later.',
            ephemeral: true
        });
    }
}
