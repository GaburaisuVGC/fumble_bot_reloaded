import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

// Create instances of the services
const userService = new UserService();
const tournamentService = new TournamentService(userService);

// Constants
const ENTRIES_PER_PAGE = 10;

export const data = new SlashCommandBuilder()
    .setName('tourleaderboard')
    .setDescription('Displays the tournament leaderboard for this server.');

export async function execute(interaction) {
    await interaction.deferReply();

    let currentPage = 0;
    let currentSortBy = 'wins'; // Default sort
    const serverId = interaction.guild ? interaction.guild.id : null;
    const serverName = interaction.guild ? interaction.guild.name : "Global";

    // Get leaderboard data from the service
    let users = await tournamentService.getLeaderboard(currentSortBy, serverId);

    const getComponents = (ended = false) => {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('lb_prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0 || ended),
                new ButtonBuilder().setCustomId('lb_next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled((currentPage + 1) * ENTRIES_PER_PAGE >= users.length || ended)
            );
        const sortRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('lb_sort_wins').setLabel('Tourn. Wins').setStyle(ButtonStyle.Secondary).setDisabled(currentSortBy === 'wins' || ended),
                new ButtonBuilder().setCustomId('lb_sort_totalWins').setLabel('Match Wins').setStyle(ButtonStyle.Secondary).setDisabled(currentSortBy === 'totalWins' || ended),
                new ButtonBuilder().setCustomId('lb_sort_winLossRatio').setLabel('W/L Ratio').setStyle(ButtonStyle.Secondary).setDisabled(currentSortBy === 'winLossRatio' || ended)
            );
        const sortRow2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('lb_sort_gained').setLabel('Aura Gained').setStyle(ButtonStyle.Secondary).setDisabled(currentSortBy === 'gained' || ended),
                new ButtonBuilder().setCustomId('lb_sort_delta').setLabel('Aura Delta').setStyle(ButtonStyle.Secondary).setDisabled(currentSortBy === 'delta' || ended)
            );
        return [row, sortRow, sortRow2];
    };

    // Create the embed using the service
    const embed = await tournamentService.createLeaderboardEmbed(interaction.client, users, currentPage, currentSortBy, serverName);
    const message = await interaction.editReply({ embeds: [embed], components: getComponents() });

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180000 }); // 3 minutes

    collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'You cannot control this leaderboard pagination/sorting.', ephemeral: true });
            return;
        }

        let refreshUsers = false;
        if (i.customId.startsWith('lb_sort_')) {
            const newSortBy = i.customId.split('_')[2];
            if (newSortBy !== currentSortBy) {
                currentSortBy = newSortBy;
                refreshUsers = true;
                currentPage = 0; // Reset to first page on new sort
            }
        } else if (i.customId === 'lb_prev' && currentPage > 0) {
            currentPage--;
        } else if (i.customId === 'lb_next' && (currentPage + 1) * ENTRIES_PER_PAGE < users.length) {
            currentPage++;
        }

        if (refreshUsers) {
            users = await tournamentService.getLeaderboard(currentSortBy, serverId);
        }

        const newEmbed = await tournamentService.createLeaderboardEmbed(interaction.client, users, currentPage, currentSortBy, serverName);
        await i.update({ embeds: [newEmbed], components: getComponents() });
    });

    collector.on('end', async collected => {
        // Fetch the final state of the embed before disabling buttons
        const finalEmbed = await tournamentService.createLeaderboardEmbed(interaction.client, users, currentPage, currentSortBy, serverName);
        interaction.editReply({ embeds: [finalEmbed], components: getComponents(true) }).catch(console.error); // Disable buttons
    });
}

// Function to be called by finishTournament
export async function displayTournamentLeaderboard(client, serverId, channelId, sort = 'wins', specificUserIds = null) {
    // Use the service to display the leaderboard
    await tournamentService.displayTournamentLeaderboard(client, serverId, channelId, sort, specificUserIds);
}