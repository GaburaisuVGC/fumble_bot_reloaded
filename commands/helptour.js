import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('helptour')
    .setDescription('Get the Tournament Commands Guide link.');

export async function execute(interaction) {
    try {
        const embed = new EmbedBuilder()
            .setColor('#00b0f4')
            .setTitle('📖 Tournament Commands Guide')
            .setDescription(
                'Click the link below to view the full guide on how to organize and manage tournaments:\n\n' +
                '[Open Tournament Commands Guide](https://github.com/GaburaisuVGC/fumble_bot_reloaded/wiki/Tournament-Commands-Guide)'
            );

        await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
        console.error('Error executing helptour command:', error);
        await interaction.reply('There was an error showing the help guide. Please try again later.');
    }
}
