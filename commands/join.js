import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

// Create instances of the services
const userService = new UserService();
const tournamentService = new TournamentService(userService);

export const data = new SlashCommandBuilder()
    .setName('join')
    .setDescription('Joins an existing Fumble Bot tournament. Organizer can specify a user.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament to join.')
            .setRequired(true))
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to join to the tournament (organizer only).')
            .setRequired(false));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
    const organizerExecutingId = interaction.user.id;
    const specifiedUser = interaction.options.getUser('user');

    let targetUserId;
    let targetUserTag;

    try {
        // Determine target user (self or specified by organizer)
        if (specifiedUser) {
            targetUserId = specifiedUser.id;
            targetUserTag = specifiedUser.tag;
        } else {
            targetUserId = organizerExecutingId;
            targetUserTag = interaction.user.tag;
        }

        // Join the tournament using the service
        const result = await tournamentService.joinTournament(
            tournamentIdInput,
            targetUserId,
            targetUserTag,
            organizerExecutingId
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Successfully Joined Tournament!')
            .setDescription(
                targetUserId === organizerExecutingId
                    ? `You have joined the tournament: **${result.tournament.tournamentId}**.`
                    : `User <@${targetUserId}> has been successfully joined to the tournament: **${result.tournament.tournamentId}** by <@${organizerExecutingId}>.`
            )
            .addFields(
                { name: 'Tournament ID', value: `\`${result.tournament.tournamentId}\``, inline: true },
                { name: 'Total Players', value: `${result.tournament.participants.length}`, inline: true },
                { name: 'Player Profile (for Pairings)', value: `[View Profile](${process.env.WEBSITE_URL}/player/${targetUserId})`, inline: true },
                { name: 'Aura Cost Paid (by user)', value: `💰 ${result.tournament.auraCost} Aura` },
                { name: 'User\'s Remaining Aura', value: `🌟 ${result.user.elo} Aura` }
            );

        try {
            const tournamentOrganizerDetails = await interaction.client.users.fetch(result.tournament.organizerId);
            embed.setFooter({ text: `Organizer: ${tournamentOrganizerDetails.tag}` });
        } catch (e) {
            console.warn(`Could not fetch organizer tag for ${result.tournament.organizerId} in join command:`, e.message);
            embed.setFooter({ text: `Organizer: <@${result.tournament.organizerId}>` });
        }
        embed.setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(`Error joining tournament ${tournamentIdInput} for user ${targetUserId || organizerExecutingId}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            if (interaction.isRepliable()) {
                await interaction.reply({ content: error.message || 'There was an error joining the tournament. Please try again later.', ephemeral: true });
            } else {
                console.error("Interaction no longer repliable for join error fallback.");
            }
        } else {
            await interaction.editReply({ content: error.message || 'There was an error joining the tournament. Please check the logs or try again later.' });
        }
    }
}