import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('info')
    .setDescription('Provides information about Fumble Bot and its commands.');
export async function execute(interaction) {
    // Create the info embed
    const infoEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('ℹ️ Fumble Bot Information ℹ️')
        .setDescription('Fumble Bot is a Discord bot designed to manage and facilitate competitive tournaments, track player statistics, and enhance the gaming experience for communities. Here are some of the main commands you can use:')
        .addFields(
            { name: '/init', value: 'Initializes your user profile in the bot\'s database. You need to do this before participating in tournaments.' },
            { name: '/createtour <aura> <prizemode>', value: 'Creates a new tournament with the specified Aura cost and prize distribution mode. Only organizers can use this command.' },
            { name: '/join <tournamentid> (user | optional)', value: 'Joins an existing tournament. You can also specify another user to join on their behalf if you are the organizer.' },
            { name: '/unjoin <tournamentid> (user | optional)', value: 'Leaves a tournament. You can also specify another user to unjoin on their behalf if you are the organizer.' },
            { name: '/starttour <tournamentid>', value: 'Starts a tournament that is in the pending state. Only the organizer can use this command.' },
            { name: '/matchreport <tournamentid> <matchid> <result>', value: 'Reports the result of a match in an ongoing tournament.' },
            { name: '/drop <tournamentid> (user | optional)', value: 'Drops a user from an ongoing tournament. You can also specify another user to drop on their behalf if you are the organizer.' },
            { name: '/resetround <tournamentid>', value: 'Resets the current round of a tournament, allowing for corrections in case of errors. Only the organizer can use this command.' },
            { name: '/validate <tournamentid>', value: 'Validates all reported match results for the current round of a tournament. Only the organizer can use this command.' },
            { name: '/leaderboard', value: 'Displays the leaderboard showing top players based on their tournament performance and statistics.' },
            { name: '/fumble (context)', value: 'Indicates that you have just fumbled with this command and wait for other users to vote for 15 minutes.' },
            { name: '/clutch (context)', value: 'Indicates that you have just clutched with this command and wait for other users to vote for 15 minutes.' },
            { name: '/rank (user | optional)', value: 'Displays your rank and statistics. You can also specify another user to view their rank.' },
            { name: '/rankserv', value: 'Server rank list showing all members and their ranks in the server.' },
            { name: '/rankinfo', value: 'Detailed information about the ranking system and how ranks are determined.' },
            { name: '/register <showdownname>', value: 'Registers your Showdown username with your Discord account for tournament tracking.' },
            { name: '/unregister', value: 'Unregisters your Showdown username from the bot.' },
            { name: '/setshowdownroom <roomname>', value: 'Sets your preferred Showdown room for the ELO tracking.' },
            { name: '/sdlook <showdownname> (format | optional)', value: 'Looks up a Showdown user\'s statistics and displays them.' },
            { name: '/sdrank', value: 'Displays the Showdown ranking leaderboard based on ELO ratings.' },
            { name: '/info', value: 'Displays this information about Fumble Bot and its commands.' }
        );

    // Send the info embed as a reply
    await interaction.reply({ embeds: [infoEmbed] });
}
