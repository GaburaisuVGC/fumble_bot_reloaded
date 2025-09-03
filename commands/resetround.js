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

    const session = await mongoose.startSession();
    session.startTransaction();

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

        const matchesToReset = await Match.find({
            tournament: tournament._id,
            roundNumber: tournament.currentRound,
            reported: true // Only find matches that were actually reported
        }).session(session);

        if (matchesToReset.length === 0) {
            await interaction.editReply(`No reported matches found for the current round (${tournament.currentRound}) of tournament ${tournament.tournamentId}. Nothing to reset.`);
            await session.abortTransaction();
            session.endSession();
            return;
        }

        let matchesResetCount = 0;
        for (const match of matchesToReset) {
            // Revert PlayerStats for player1 if data exists
            if (match.player1 && match.player1.userId && match.player1StatsBeforeReport) {
                const p1Stat = await PlayerStats.findOne({ tournament: tournament._id, userId: match.player1.userId }).session(session);
                if (p1Stat) {
                    p1Stat.wins = match.player1StatsBeforeReport.wins;
                    p1Stat.losses = match.player1StatsBeforeReport.losses;
                    p1Stat.draws = match.player1StatsBeforeReport.draws;
                    p1Stat.score = match.player1StatsBeforeReport.score;
                    await p1Stat.save({ session });
                }
            }

            // Revert PlayerStats for player2 if data exists
            if (match.player2 && match.player2.userId && match.player2StatsBeforeReport) {
                const p2Stat = await PlayerStats.findOne({ tournament: tournament._id, userId: match.player2.userId }).session(session);
                if (p2Stat) {
                    p2Stat.wins = match.player2StatsBeforeReport.wins;
                    p2Stat.losses = match.player2StatsBeforeReport.losses;
                    p2Stat.draws = match.player2StatsBeforeReport.draws;
                    p2Stat.score = match.player2StatsBeforeReport.score;
                    await p2Stat.save({ session });
                }
            }

            // Reset match fields
            match.reported = false;
            match.winnerId = null;
            match.isDraw = false;
            match.player1StatsBeforeReport = undefined; // Clear the stored previous stats
            match.player2StatsBeforeReport = undefined;
            await match.save({ session });
            matchesResetCount++;
        }

        await session.commitTransaction();

        // Check if any matches were reset
        if (matchesResetCount === 0) {
            await interaction.editReply(`No reported matches found for the current round (${tournament.currentRound}) of tournament ${tournament.tournamentId}. Nothing to reset.`);
            return;
        }
        await interaction.editReply(`Successfully reset ${matchesResetCount} reported match(es) for round ${tournament.currentRound} of tournament ${tournament.tournamentId}. You can now re-report these matches.`);

        console.log(`Reset ${matchesResetCount} match results for tournament ${tournamentId} on server ${interaction.guildId}`);

    } catch (error) {
        console.error(`Error resetting round results for tournament ${tournamentId}:`, error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error resetting the round results. Please try again later.'}` 
        });
    } finally {
        session.endSession();
    }
}