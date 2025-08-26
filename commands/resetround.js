import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('resetround')
    .setDescription('Resets all reported results for the current round of a tournament. Organizer only.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament.')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = interaction.options.getString('tournamentid').toUpperCase();
    const organizerId = interaction.user.id;

    // Initialize services
    const userService = new UserService();
    const tournamentService = new TournamentService(userService);

    try {
        // First, get the tournament to check if it exists and if the user is the organizer
        const tournament = await tournamentService.getTournamentById(tournamentId);
        
        if (!tournament) {
            await interaction.editReply(`Tournament with ID \`${tournamentId}\` not found.`);
            return;
        }

        if (tournament.organizerId !== organizerId) {
            await interaction.editReply('Only the tournament organizer can reset round results.');
            return;
        }

        if (tournament.status !== 'active') {
            await interaction.editReply(`Tournament is not active. Current status: ${tournament.status}. Cannot reset round results.`);
            return;
        }

        // Check if there's a current round to reset (currentRound > 0)
        if (tournament.currentRound === 0) {
            await interaction.editReply(`Tournament ${tournament.tournamentId} hasn't started any rounds yet (currentRound is 0). Nothing to reset.`);
            return;
        }

        // Reset the current round using the service
        const result = await tournamentService.resetRound(tournamentId, tournament.currentRound);
        
        // Check if any matches were reset
        if (result.matchesResetCount === 0) {
            await interaction.editReply(`No reported matches found for the current round (${tournament.currentRound}) of tournament ${tournament.tournamentId}. Nothing to reset.`);
            return;
        }

        await interaction.editReply(`Successfully reset ${result.matchesResetCount} reported match(es) for round ${tournament.currentRound} of tournament ${tournament.tournamentId}. You can now re-report these matches.`);

    } catch (error) {
        console.error(`Error resetting round results for tournament ${tournamentId}:`, error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error resetting the round results. Please try again later.'}` 
        });
    }
}