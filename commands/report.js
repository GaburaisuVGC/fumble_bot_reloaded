import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('matchreport')
    .setDescription('Reports the result of a tournament match.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('matchid')
            .setDescription('The ID of the match (e.g., 001, 002).')
            .setRequired(true))
    .addUserOption(option =>
        option.setName('winner')
            .setDescription('The Discord user who won the match.')
            .setRequired(true))
    .addUserOption(option => // Optional, only if it's a draw
        option.setName('draw_opponent')
            .setDescription('The other opponent in case of a draw. Leave blank if not a draw.')
            .setRequired(false));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
        const matchIdInput = interaction.options.getString('matchid');
        const winnerUser = interaction.options.getUser('winner');
        const drawOpponentUser = interaction.options.getUser('draw_opponent'); // Can be null
        const reportingUserId = interaction.user.id;
        const reportingUserTag = interaction.user.tag;

        // Initialize services
        const userService = new UserService();
        const tournamentService = new TournamentService(userService);

        // Report the match
        const result = await tournamentService.reportMatch(
            tournamentIdInput,
            matchIdInput,
            winnerUser.id,
            winnerUser.tag,
            drawOpponentUser ? drawOpponentUser.id : null,
            drawOpponentUser ? drawOpponentUser.tag : null,
            reportingUserId,
            reportingUserTag
        );

        // Create and send the embed
        const embed = new EmbedBuilder()
            .setColor(result.isDraw ? '#FFFF00' : '#00FF00')
            .setTitle('✅ Match Result Reported!')
            .setDescription(result.resultMessage)
            .addFields(
                { name: 'Tournament', value: result.tournament.tournamentId, inline: true },
                { name: 'Match ID', value: result.match.matchId, inline: true }
            )
            .setFooter({ text: `Reported by: ${interaction.user.tag}`})
            .setTimestamp();

        // Send to the channel, not ephemeral, so others can see results.
        await interaction.guild.channels.cache.get(interaction.channelId).send({ embeds: [embed] });
        // delete the reply
        await interaction.deleteReply();

        console.log(`A match was reported in tournament ${tournamentIdInput} on server ${interaction.guildId}`);
        
    } catch (error) {
        console.error(`Error reporting match:`, error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error reporting the match. Please try again later.'}`,
            ephemeral: true 
        });
    }
}