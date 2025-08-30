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
        .setTitle('CHANGELOG - Aura Give command')
        .setDescription(
            "Aura Give is here! You can now give aura to other users with the `/auragive` command.\n\n" +
            "Keep in mind that giving aura has a 20% commission fee, which goes to the giver.\n" +
            "Receiving aura resets your combo multiplier to 1x, while giving aura increases your combo multiplier by 0.2x.\n" +
            "This would be useful for future clutch commands or tournament rewards where combo multiplier matters.\n" +
            "Also, users can only receive aura once per day, so choose wisely!\n\n"
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
