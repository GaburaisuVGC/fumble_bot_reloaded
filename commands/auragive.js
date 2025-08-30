import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import UserService from '../services/user/UserService.js';

export const data = new SlashCommandBuilder()
    .setName('auragive')
    .setDescription('Give aura to another user.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to give aura to.')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('aura')
            .setDescription('The amount of aura to give.')
            .setRequired(true));

export async function execute(interaction) {
    const giverUser = interaction.user;
    const receiverMember = interaction.options.getMember('user');
    const receiverUser = receiverMember.user;
    const auraAmount = interaction.options.getInteger('aura');

    if (receiverUser.id === giverUser.id) {
        return interaction.reply({ content: 'You cannot give aura to yourself.', ephemeral: true });
    }

    if (auraAmount <= 0) {
        return interaction.reply({ content: 'You must give a positive amount of aura.', ephemeral: true });
    }

    const userService = new UserService();

    try {
        await interaction.deferReply();

        const giver = await userService.findOrCreateUser(giverUser.id, giverUser.tag);
        const receiver = await userService.findOrCreateUser(receiverUser.id, receiverUser.tag);

        if (!receiver.canReceiveAura) {
            return interaction.editReply({ content: `${receiver.username} has already received an auragive today.` });
        }

        if (giver.elo < auraAmount) {
            return interaction.editReply({ content: `You don't have enough aura to give. You have ${giver.elo} aura.` });
        }

        const commission = Math.floor(auraAmount * 0.20);
        const netAmount = auraAmount - commission;

        // Update giver
        const newGiverElo = giver.elo - auraAmount + commission;
        giver.comboMultiplier += 0.2;
        await userService.updateUserRankPeakLow(giver, newGiverElo);

        // Update receiver
        const newReceiverElo = receiver.elo + netAmount;
        receiver.comboMultiplier = 1;
        receiver.canReceiveAura = false;
        await userService.updateUserRankPeakLow(receiver, newReceiverElo);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('✨ Aura Transfer ✨')
            .setDescription(`${giverUser.username} has blessed ${receiverUser.username} with ${auraAmount} aura!`)
            .addFields(
                { name: 'Giver', value: giverUser.username, inline: true },
                { name: 'Receiver', value: receiverUser.username, inline: true },
                { name: 'Amount', value: `${auraAmount}`, inline: false },
                { name: 'Commission (20%)', value: `+${commission} aura for ${giverUser.username}`, inline: false },
                { name: 'Giver\'s New Multiplier Combo', value: `${giver.comboMultiplier.toFixed(1)}x`, inline: false },
                { name: 'Receiver\'s Multiplier Combo Reset', value: '1x', inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        console.log(`Aura give: ${giverUser.username} gave ${auraAmount} aura to ${receiverUser.username} on server ${interaction.guildId}`);

    } catch (error) {
        console.error('Error in auragive command:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'An error occurred while processing the auragive.', ephemeral: true });
        } else {
            await interaction.reply({ content: 'An error occurred while processing the auragive.', ephemeral: true });
        }
    }
}
