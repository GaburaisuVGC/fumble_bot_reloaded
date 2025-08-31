import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';
import Tournament from '../models/Tournament.js';
import PlayerStats from '../models/PlayerStats.js';
import Match from '../models/Match.js';
import { config } from 'dotenv';

config();

const botOwnerId = process.env.BOT_OWNER_ID;

export const data = new SlashCommandBuilder()
    .setName('deletetour')
    .setDescription('Deletes a tournament and all of its data.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament to delete.')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = interaction.options.getString('tournamentid').toUpperCase();
    const userId = interaction.user.id;
    const member = interaction.member;

    try {
        const tournament = await Tournament.findOne({ tournamentId: tournamentId });

        if (!tournament) {
            return interaction.editReply({ content: 'Tournament not found.' });
        }

        const isOrganizer = tournament.organizerId === userId;
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator) && tournament.serverId === interaction.guildId;
        const isBotOwner = userId === botOwnerId;

        if (!isOrganizer && !isAdmin && !isBotOwner) {
            return interaction.editReply({ content: 'You do not have permission to delete this tournament. Admins can only delete tournaments from the server they were created in.' });
        }

        // Delete associated player stats and matches
        await PlayerStats.deleteMany({ tournament: tournament._id });
        await Match.deleteMany({ tournament: tournament._id });

        // Delete the tournament
        await Tournament.deleteOne({ _id: tournament._id });

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('✅ Tournament Deleted')
            .setDescription(`The tournament with ID **${tournamentId}** has been successfully deleted.`)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        console.log(`Tournament ${tournamentId} deleted by ${interaction.user.tag} on server ${interaction.guildId}`);

    } catch (error) {
        console.error(`Error deleting tournament ${tournamentId}:`, error);
        await interaction.editReply({ content: 'There was an error deleting the tournament.' });
    }
}
