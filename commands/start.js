import { SlashCommandBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('starttour')
    .setDescription('Starts a pending tournament, generates Round 1 pairings.')
    .addStringOption(option =>
        option.setName('tournamentid')
            .setDescription('The ID of the tournament to start.')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
        const tournamentIdInput = interaction.options.getString('tournamentid').toUpperCase();
        const organizerId = interaction.user.id;
        const organizerTag = interaction.user.tag;

        // Initialize services
        const userService = new UserService();
        const tournamentService = new TournamentService(userService);

        // Start the tournament and generate pairings
        const result = await tournamentService.startTournamentWithPairings(
            tournamentIdInput,
            organizerId,
            organizerTag
        );

        // Send the embed with tournament details and pairings
        await interaction.editReply({ embeds: [result.embed] });
        console.log(`Tournament started on server ${interaction.guild.id}`);
    } catch (error) {
        console.error(`Error starting tournament:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'There was an error starting the tournament. Please try again later.', ephemeral: true });
        } else {
            await interaction.editReply({ content: `Error: ${error.message || 'There was an error starting the tournament. Please try again later.'}` });
        }
    }
}