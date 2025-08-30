import { Client, Collection, Events, EmbedBuilder } from 'discord.js';
import connectToDatabase from './database.js';
import { readdirSync } from 'fs';
import Tournament from './models/Tournament.js';
import User from './models/User.js';
import { schedule } from 'node-cron';
import { config } from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import ShowdownService from './services/showdown/ShowdownService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config();

const token = process.env.DISCORD_TOKEN;
const client = new Client({ intents: 32767 });

client.commands = new Collection();

// Load commands
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const fileURL = pathToFileURL(filePath);
    const command = await import(fileURL);
    client.commands.set(command.data.name, command);
}

// Create services
const showdownService = new ShowdownService(client);

client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);

    await connectToDatabase();

    const commands = client.commands.map(command => command.data.toJSON());
    await client.application.commands.set(commands);

    console.log('Global commands registered.');

    // Schedule daily summary task at 7 AM (UTC+2)
    schedule('0 7 * * *', async () => {
        console.log('Running daily cron job...');

        try {
            // Increment daysAlive for all tournaments
            await Tournament.updateMany({}, { $inc: { daysAlive: 1 } });
            console.log('Incremented daysAlive for all tournaments.');

            // Delete tournaments older than 30 days
            const deletionResult = await Tournament.deleteMany({ daysAlive: { $gte: 30 } });
            if (deletionResult.deletedCount > 0) {
                console.log(`Deleted ${deletionResult.deletedCount} old tournaments.`);
            }

            // Reset canReceiveAura for all users
            await User.updateMany({}, { $set: { canReceiveAura: true } });
            console.log('Reset canReceiveAura for all users.');

            // Send daily summary
            console.log('Sending daily summary...');
            showdownService.sendDailySummary();

        } catch (error) {
            console.error('Error during daily cron job:', error);
        }
    }, {
        timezone: 'Europe/Paris'
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
    }
});

client.login(token);