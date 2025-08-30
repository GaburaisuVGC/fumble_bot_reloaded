import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import User from "../models/User.js";
import Server from "../models/Server.js";

// function to fetch users
async function fetchUsers(users, interaction) {
  // Filter users to only include those present in the discord server
  // For that we need to fetch all users in the guild and check if their id is in the users array
  const guildMembers = await interaction.guild.members.fetch();
  const guildMemberIds = guildMembers.map((member) => member.user.id);
  users = users.filter((user) => guildMemberIds.includes(user.discordId));
  return users;
}

export const data = new SlashCommandBuilder()
  .setName("rankserv")
  .setDescription("Displays the leaderboard of all users by Elo.");
export async function execute(interaction) {
  // Fetch the server id where the command was executed
  const guildId = interaction.guildId;

  // Fetch the server document from the database
  let server = await Server.findOne({ discordId: guildId });

  // Get all users from the database, sorted by Elo in descending order
  let users = await User.find().sort({ elo: -1 });

  if (!server) {
    // Create a server document if it doesn't exist
    server = new Server({
      discordId: guildId,
      registeredUsers: [],
    });

    users = await fetchUsers(users, interaction);

    // Save the server document
    await server.save();
  }

  users = await fetchUsers(users, interaction);

  // If no users found, inform the user
  if (users.length === 0) {
    await interaction.reply({
      content: "No users found in the database.",
      ephemeral: true,
    });
    return;
  }

  // Prepare the leaderboard information
  const usersInfo = [];

  // Format each user's info for the leaderboard
  users.forEach((user, index) => {
    const userInfo = `${index + 1}. ${user.username} - ${user.elo} (${
      user.peakElo
    }) - ${user.rank}`;
    usersInfo.push(userInfo);
  });

  // Create an embed for the leaderboard
  const rankServEmbed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Fumble Bot Leaderboard")
    .setDescription(usersInfo.join("\n"))
    .setTimestamp();

  // Send the embed
  await interaction.reply({ embeds: [rankServEmbed] });
    console.log(`Leaderboard requested on server ${guildId}`);
}
