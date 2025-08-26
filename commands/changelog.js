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
    //         "Please **register votre Showdown username again** to get daily tracking."
    //     )
    //     .setTimestamp();
    const infoEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('CHANGELOG - Complete Refactoring')
        .setDescription(
            "The bot has been completely refactord from scratch with a full English translation to make it public in the future.\n\n" +
            "Some features are still in testing and might not work as intended.\n\n" +
            "Other new features will be added soon.\n\n" +
            "Reset: The AURA gained from fumbles, clutches and tournaments has been reset to 1000 (Iron I) for everyone.\n\n"
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
