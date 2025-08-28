import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("info")
  .setDescription("Provides information about Fumble Bot and its commands.");

export async function execute(interaction) {
  const infoEmbed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("ℹ️ Fumble Bot Information ℹ️")
    .setDescription(
      "Fumble Bot is a Pokémon VGC oriented Discord Bot where you can track your Showdown ELO ratings and organize tournaments directly in Discord. Here are some of the main commands:"
    )
    .addFields(
      { name: "🏆 **Tournament Commands**", value: "\u200B", inline: false },
      {
        name: "/helptour",
        value:
          "Provides a link to the complete Tournament Commands Guide. (very useful!)",
      },
      {
        name: "/createtour <aura> <prizemode> <cuttype> (pointsrequired | optional) (title | optional) (description | optional)",
        value:
          "Creates a new tournament with the specified Aura cost, prize distribution mode and top cut type. Only organizers can use this command.",
      },
      {
        name: "/join <tournamentid> (user | optional)",
        value:
          "Joins an existing tournament. You can also specify another user to join on their behalf if you are the organizer.",
      },
      {
        name: "/starttour <tournamentid>",
        value:
          "Starts a tournament that is in the pending state. Only the organizer can use this command.",
      },
      {
        name: "/matchreport <tournamentid> <matchid> <winner> (draw_opponent | optional)",
        value: "Reports the result of a match in an ongoing tournament.",
      },
      {
        name: "/drop <tournamentid> (user | optional)",
        value:
          "Drops a user from an ongoing tournament. You can also specify another user to drop on their behalf if you are the organizer.",
      },
      {
        name: "/validate <tournamentid>",
        value:
          "Validates all reported match results for the current round of a tournament. Only the organizer can use this command.",
      },
      {
        name: "/tourleaderboard",
        value:
          "Displays the leaderboard showing top players based on their tournament performance and statistics.",
      },

      { name: "\u200B", value: "\u200B", inline: false },
      { name: "📊 **ELO Tracking & Ranking**", value: "\u200B", inline: false },
      {
        name: "/register <showdownname>",
        value:
          "Registers your or another player's Showdown username with your Discord account for tournament tracking.",
      },
      {
        name: "/setshowdownroom <roomname>",
        value: "Sets your preferred Showdown room for the ELO tracking.",
      },

      { name: "\u200B", value: "\u200B", inline: false },
      { name: "🎮 **Fun Commands**", value: "\u200B", inline: false },
      {
        name: "/fumble (context)",
        value:
          "Indicates that you have just fumbled with this command and wait for other users to vote for 15 minutes.",
      },
      {
        name: "/clutch (context)",
        value:
          "Indicates that you have just clutched with this command and wait for other users to vote for 15 minutes.",
      },

      { name: "\u200B", value: "\u200B", inline: false },
      { name: "🤖 **Bot General Commands**", value: "\u200B", inline: false },
      {
        name: "/setorganizer <user>",
        value: "Sets a user as an organizer who can create and manage tournaments. (Admin only)",
      },
      {
        name: "/rank (user | optional)",
        value:
          "Displays your rank and statistics. You can also specify another user to view their rank.",
      },
      {
        name: "/rankserv",
        value:
          "Server rank list showing all members and their ranks in the server.",
      },
      {
        name: "/rankinfo",
        value:
          "Detailed information about the ranking system and how ranks are determined.",
      },

      { name: "\u200B", value: "\u200B", inline: false },
      {
        name: "All Commands",
        value:
          "[Click here to view all commands and their descriptions](https://github.com/GaburaisuVGC/fumble_bot_reloaded/wiki/All-Commands)",
      }
    );

  await interaction.reply({ embeds: [infoEmbed] });
}
