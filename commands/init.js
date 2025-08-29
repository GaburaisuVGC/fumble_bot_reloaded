import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import User from '../models/User.js';

export const data = new SlashCommandBuilder()
    .setName('init')
    .setDescription('Initializes a user in the database.');
export async function execute(interaction) {
    const { user } = interaction;

    try {
        // Check if the user already exists
        let existingUser = await User.findOne({ discordId: user.id });
        if (existingUser) {
            await interaction.reply({ content: 'User already initialized!' });
            return;
        }

        // Create a new user with default values
        const newUser = new User({
            discordId: user.id,
            username: user.username,
            rank: 'Iron I',
            elo: 1000,
            fumbles: 0,
            clutches: 0,
            peakElo: 1000,
            lowestElo: 1000,
            fumbleCombo: 0,
            clutchCombo: 0
        });

        await newUser.save();

        // Create a welcome embed
        const welcomeEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Welcome to Fumble Bot!')
            .setDescription(`Welcome, ${user.username}!`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Rank', value: 'Iron I', inline: true },
                { name: 'AURA', value: '1000', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Fumble Bot' });

        await interaction.reply({ embeds: [welcomeEmbed] });
    } catch (error) {
        console.error('Error initializing user:', error);
        await interaction.reply({ content: 'There was an error initializing the user.' });
    }
}
