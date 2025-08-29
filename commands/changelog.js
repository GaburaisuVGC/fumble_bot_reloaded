import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';
import Server from '../models/Server.js';
import { config } from 'dotenv';
config();


export const data = new SlashCommandBuilder()
    .setName('changelog')
    .setDescription("Sends the changelog to all servers' showdownRoom (admin only).");

export async function execute(interaction) {
    const authorizedUserId = process.env.BOT_ADMIN_ID;

    // Check if the user is authorized to use this command
    if (interaction.user.id !== authorizedUserId) {
        return interaction.reply({ content: "You are not authorized to use this command.", ephemeral: true });
    }

    // Create the changelog embed
    // const infoEmbed = new EmbedBuilder()
    //     .setColor('#0099ff')
    //     .setTitle('Changelog - Format update')
    //     .setDescription(
    //         "The new default format is **Reg I Bo3 (VGC 2025)**.\n\n" +
    //         "Please **register your Showdown username again** to get daily tracking."
    //     )
    //     .setTimestamp();
    const infoEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('CHANGELOG - Tournament System finished & Security Checks')
        .setDescription(
            "The tournament system is now fully functional and can be used to create and manage tournaments directly from Discord.\n\n" +
            "Day 2 and asymmetrical top cut are part of the new features.\n\n" +
            "Organization commands for tournaments and ELO tracking are now restricted to server organizers (set with /setorganizer by an admin of the server).\n\n" +  
            "Registering a Showdown username will link it to your Discord account in order to make other users unable to unregister your username.\n\n" +
            "An elo update based on the showdown username evolution will be considered for future updates.\n\n"
        )
        .setTimestamp();

    // Send the changelog to all servers' showdownRoom
    const guilds = interaction.client.guilds.cache;

    // For each server the bot is in
    guilds.forEach(async (guild) => {
        try {
            // Fetch server data from the database
            const serverData = await Server.findOne({ discordId: guild.id });

            // If a showdownRoom is set, send the changelog there
            if (serverData && serverData.showdownRoom) {
                // Get the channel by ID
                const channel = guild.channels.cache.get(serverData.showdownRoom);

                // Check if the channel exists and the bot has permission to send messages
                if (channel && channel.isTextBased() && channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
                    console.log(`Sending changelog to server: ${guild.name}`);
                    await channel.send({ embeds: [infoEmbed] });
                }
            }
        } catch (error) {
            console.error(`Issue sending changelog to server ${guild.name}:`, error);
        }
    });

    // Acknowledge the command execution
    await interaction.reply({ content: "Changelog sent to all servers' showdownRoom.", ephemeral: true });
}
