import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('drop')
    .setDescription('Drops a player from a tournament. Organizer only.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament.')
            .setRequired(true))
    .addUserOption(option =>
        option.setName('player')
            .setDescription('The player to drop.')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true }); // Ephemeral for organizer actions

    try {
        const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
        const targetUser = interaction.options.getUser('player');
        const organizerId = interaction.user.id;

        // Initialize services
        const userService = new UserService();
        const tournamentService = new TournamentService(userService);

        // Drop the player from the tournament
        const result = await tournamentService.dropPlayer(tournamentIdInput, targetUser.id, organizerId);

        // Send success message
        await interaction.editReply({
            content: `Player <@${targetUser.id}> has been dropped from tournament ${tournamentIdInput}. They will not be included in future pairings. ${result.matchUpdateMessage}`,
            allowedMentions: { users: [targetUser.id] } // Ensure the user gets pinged
        });
    } catch (error) {
        console.error(`Error dropping player for tournament:`, error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error dropping the player. Please try again later.'}`,
            ephemeral: true 
        });
    }
}