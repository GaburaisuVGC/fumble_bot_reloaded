import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import cheerio from 'cheerio';

async function getUserData(username, format = 'gen9vgc2025reghbo3') {
    try {
        const response = await axios.get(`https://pokemonshowdown.com/users/${username}`);
        const html = response.data;
        const $ = cheerio.load(html);

        // Look for the table row that matches the specified format
        const tables = $('table');
        let formatStats;

        tables.each((index, table) => {
            const rows = $(table).find('tr');
            rows.each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length > 0 && $(cells[0]).text().includes(format)) {
                    formatStats = cells;
                }
            });
        });

        if (!formatStats) {
            throw new Error(`Format ${format} not found for this user.`);
        }

        // Extract the relevant stats
        const elo = $(formatStats[1]).text().trim();
        const gxe = $(formatStats[2]).text().trim();

        return { username, elo, gxe };
    } catch (error) {
        console.error('Error fetching user data from Showdown:', error);
        throw error;
    }
}

export const data = new SlashCommandBuilder()
    .setName('sdlook')
    .setDescription('Look up a Showdown user\'s current Elo and GXE for a specific format.')
    .addStringOption(option => option.setName('username')
        .setDescription('The Showdown username to look up (case-sensitive).')
        .setRequired(true))
    .addStringOption(option => option.setName('format')
        .setDescription('The format to look up (default: gen9vgc2025reghbo3).')
        .setRequired(false));
export async function execute(interaction) {
    const username = interaction.options.getString('username');
    const format = interaction.options.getString('format') || 'gen9vgc2025reghbo3';

    try {
        // Fetch user data from Showdown
        const userData = await getUserData(username, format);

        // Create and send the embed with user data
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`Showdown User: ${userData.username}`)
            .setDescription(`Format: **${format}**`)
            .addFields(
                { name: 'ELO', value: userData.elo, inline: true },
                { name: 'GXE', value: userData.gxe, inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error during sdlook command execution:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Error')
            .setDescription(`Could not retrieve data for username **${username}**. Please ensure the username is correct and has played in the specified format.`);

        await interaction.reply({ embeds: [errorEmbed] });
    }
}
