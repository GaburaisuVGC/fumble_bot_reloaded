import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import User from '../models/User.js';

export const data = new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Displays the rank and stats of a user.')
    .addUserOption(option => option.setName('user')
        .setDescription('The user to display stats for. If not provided, shows your own stats.'));
export async function execute(interaction) {
    const targetUser = interaction.options.getUser("user") || interaction.user;

    let user;
    try {
        user = await User.findOne({ discordId: targetUser.id });
    } catch (error) {
        console.error("Error fetching user data:", error);
        await interaction.reply({ content: "There was an error fetching the user data.", ephemeral: true });
        return;
    }

    if (!user) {
        await interaction.reply({ content: "User not found. They may need to initialize with /init.", ephemeral: true });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`Stats for ${targetUser.username}`)
        .setURL(`${process.env.WEBSITE_URL}/player/${targetUser.id}`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "AURA", value: user.elo.toString() },
            { name: "Rank", value: user.rank.toString() },
            { name: "Peak AURA", value: user.peakElo.toString() },
            { name: "Lowest AURA", value: user.lowestElo.toString() },
            { name: "Fumbles", value: user.fumbles.toString() },
            { name: "Clutches", value: user.clutches.toString() },
            { name: "Fumble Combo", value: user.fumbleCombo.toString() },
            { name: "Clutch Combo", value: user.clutchCombo.toString() }
        );

    await interaction.reply({ embeds: [embed] });
}
