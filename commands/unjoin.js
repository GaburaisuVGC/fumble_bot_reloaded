import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('unjoin')
    .setDescription('Leaves a tournament. Organizer can specify a user.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament to leave.')
            .setRequired(true))
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to remove from the tournament (organizer only).')
            .setRequired(false));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const tournamentId = interaction.options.getString('tournamentid').toUpperCase();
    const organizerExecutingId = interaction.user.id;
    const specifiedUser = interaction.options.getUser('user');

    // Initialize services
    const userService = new UserService();
    const tournamentService = new TournamentService(userService);

    try {
        // Determine target user
        let targetUserId;
        let targetUserTag;

        if (specifiedUser) {
            // Check if the executing user is the organizer (this will be validated in the service)
            targetUserId = specifiedUser.id;
            targetUserTag = specifiedUser.tag;
        } else {
            targetUserId = organizerExecutingId;
            targetUserTag = interaction.user.tag;
        }

        // Call the service to leave the tournament
        const result = await tournamentService.leaveTournament(
            tournamentId, 
            targetUserId, 
            targetUserTag, 
            organizerExecutingId
        );

        // Create success embed
        const unjoinMessage = targetUserId === organizerExecutingId ?
            `You have left the tournament: **${result.tournament.tournamentId}**.` :
            `User <@${targetUserId}> has been unjoined from tournament **${result.tournament.tournamentId}** by <@${organizerExecutingId}>.`;

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('↩️ Successfully Left Tournament')
            .setDescription(unjoinMessage)
            .addFields(
                { name: 'Tournament ID', value: `\`${result.tournament.tournamentId}\`` },
                { name: 'Aura Refunded (to user)', value: `💰 ${result.tournament.auraCost} Aura` },
                { name: 'User\'s Current Aura', value: `🌟 ${result.user.elo} Aura` }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error leaving tournament ${tournamentId}:`, error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error leaving the tournament. Please try again later.'}` 
        });
    }
}