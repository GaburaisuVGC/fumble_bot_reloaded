import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import Server from '../models/Server.js';

export const data = new SlashCommandBuilder()
    .setName('setshowdownroom')
    .setDescription('Set the channel for automatic Showdown messages.')
    .addChannelOption(option => option.setName('channel')
        .setDescription('The channel to set for automatic messages.')
        .setRequired(true));
export async function execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    try {
        // Fetch the server document from the database
        let server = await Server.findOne({ discordId: guildId });

        if (!server) {
            // If the server doesn't exist, create a new one
            server = new Server({
                discordId: guildId,
                showdownRoom: channel.id
            });
        } else {
            // If the server exists, update the showdownRoom
            server.showdownRoom = channel.id;
        }

        // Save the changes to the database
        await server.save();

        // Respond with a confirmation embed
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Showdown Room Set')
            .setDescription(`The channel **${channel.name}** has been set for automatic Showdown messages.`);

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error setting showdown room:', error);
        await interaction.reply('There was an error setting the Showdown room. Please try again later.');
    }
}
