import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import cheerio from 'cheerio';
import Server from '../models/Server.js';

async function getUserData(username) {
    try {
        const response = await axios.get(`https://pokemonshowdown.com/users/${username}`);
        const html = response.data;
        const $ = cheerio.load(html);

        // Extract the username (pseudo)
        const pseudo = $('h1').text().trim();

        // Find the table containing the stats
        const tables = $('table');
        let formatStats;

        tables.each((index, table) => {
            const rows = $(table).find('tr');
            rows.each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length > 0 && $(cells[0]).text().includes('gen9vgc2025reghbo3')) {
                    formatStats = cells;
                }
            });
        });

        if (!formatStats) {
            console.log('Format gen9vgc2025reghbo3 not found for this user.');
            return;
        }

        // Extract Elo and GXE
        const elo = $(formatStats[1]).text().trim();
        const gxe = $(formatStats[2]).text().trim();

        return { pseudo, elo, gxe };
    } catch (error) {
        console.error('Error fetching user data from Showdown:', error);
    }
}

export const data = new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register your Showdown username for daily tracking.')
    .addStringOption(option => option.setName('username')
        .setDescription('Your Showdown username (case-sensitive).')
        .setRequired(true));
export async function execute(interaction) {
    const username = interaction.options.getString('username');
    const guildId = interaction.guildId;

    try {
        // Check if the server exists in the database
        let server = await Server.findOne({ discordId: guildId });

        if (!server) {
            // If the server does not exist, create it
            server = new Server({
                discordId: guildId,
                registeredUsers: []
            });

            // Add the user to registeredUsers with their information
            const userData = await getUserData(username);

            if (!userData) {
                throw new Error('User information could not be retrieved. You probably have not played in gen9vgc2025reghbo3.');
            }

            server.registeredUsers.push({ username, elo: userData.elo, gxe: parseFloat(userData.gxe), discordId: interaction.user.id });
        } else {
            // If the server exists, check if the user is already registered
            const userIndex = server.registeredUsers.findIndex(user => user.username === username);
            if (userIndex === -1) {
                const userData = await getUserData(username);
                if (!userData) {
                    throw new Error('User information could not be retrieved. You probably have not played in gen9vgc2025reghbo3.');
                }
                server.registeredUsers.push({ username, elo: userData.elo, gxe: parseFloat(userData.gxe), discordId: interaction.user.id });
            } else {
                // User is already registered
                await interaction.reply(`Username **${username}** is already registered for this server.`);
                return;
            }
        }

        // Save the server document
        await server.save();

        // Fetch user data to display in the confirmation embed
        const userData = await getUserData(username);
        if (!userData) {
            throw new Error('User information could not be retrieved. You probably have not played in gen9vgc2025reghbo3.');
        }
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Showdown Registration Successful')
            .setDescription(`Username **${username}** has been registered successfully.`)
            .addFields(
                { name: 'Username', value: userData.pseudo, inline: true },
                { name: 'Elo', value: userData.elo, inline: true },
                { name: 'GXE', value: userData.gxe, inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        let server = await Server.findOne({ discordId: guildId });
        console.error('Error during registration:', error);
        console.log("server", server);
        await interaction.reply('There was an error during registration. It might be because Pokémon Showdown user data fetch is unavailable for the moment, or the username is already registered or user information could not be retrieved. You probably have not played in gen9vgc2025reghbo3.');
        }
}
