import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import TournamentService from '../services/tournament/TournamentService.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('createtour')
    .setDescription('Creates a new Fumble Bot tournament.')
    .addIntegerOption(option =>
        option.setName('aura')
            .setDescription('The amount of Aura (ELO) required to join the tournament.')
            .setRequired(true)
            .setMinValue(0)) // Aura cost can be 0 for free tournaments
    .addStringOption(option =>
        option.setName('prizemode')
            .setDescription('How the cash prize will be distributed.')
            .setRequired(true)
            .addChoices(
                { name: 'Winner Takes All', value: 'all' },
                { name: 'Spread Proportionally (Top Cut or Top 4)', value: 'spread' }
            ));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const organizerId = interaction.user.id;
    const serverId = interaction.guild.id;
    const auraCost = interaction.options.getInteger('aura');
    const prizeMode = interaction.options.getString('prizemode');

    // Initialize services
    const userService = new UserService();
    const tournamentService = new TournamentService(userService);

    try {
        // Check if the organizer is a registered user in the bot's system
        const organizerUser = await userService.findOrCreateUser(organizerId, interaction.user.tag);
        if (!organizerUser) {
            await interaction.editReply('You need to be registered with the bot to create a tournament. Use `/init` if you haven\'t already.');
            return;
        }

        // Create the tournament using the service
        const newTournament = await tournamentService.createTournament(
            serverId,
            organizerId,
            auraCost,
            prizeMode
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🏆 Tournament Created! 🏆')
            .setDescription(`A new tournament has been set up. Let the games begin (soon)!`)
            .addFields(
                { name: 'Tournament ID', value: `\`${newTournament.tournamentId}\``, inline: true },
                { name: 'Organizer', value: `<@${organizerId}>`, inline: true },
                { name: 'Aura Cost to Join', value: `💰 ${auraCost} Aura`, inline: true },
                { name: 'Prize Mode', value: prizeMode === 'all' ? 'Winner Takes All' : 'Proportional Spread', inline: true },
                { name: 'Status', value: '🔔 Pending (Waiting for players)', inline: true }
            )
            .setFooter({ text: 'Use /join <tournament_id> to enter!' })
            .setTimestamp();

        // Send the reply to the channel where the command was used
        await interaction.followUp({ embeds: [embed], ephemeral: false }); // Not ephemeral so everyone can see

    } catch (error) {
        console.error('Error creating tournament:', error);
        await interaction.editReply({ 
            content: `Error: ${error.message || 'There was an error creating the tournament. Please try again later.'}` 
        });
    }
}