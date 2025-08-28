import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import TournamentService from "../services/tournament/TournamentService.js";
import UserService from "../services/user/UserService.js";

export const data = new SlashCommandBuilder()
  .setName("createtour")
  .setDescription("Creates a new Fumble Bot tournament.")
  .addIntegerOption((option) =>
    option
      .setName("aura")
      .setDescription(
        "The amount of Aura (ELO) required to join the tournament."
      )
      .setRequired(true)
      .setMinValue(0)
  )
  .addStringOption((option) =>
    option
      .setName("prizemode")
      .setDescription("How the cash prize will be distributed.")
      .setRequired(true)
      .addChoices(
        { name: "Winner Takes All", value: "all" },
        { name: "Spread Proportionally (Top Cut or Top 4)", value: "spread" }
      )
  )
  .addStringOption((option) =>
    option
      .setName("cuttype")
      .setDescription("The method for determining the top cut.")
      .setRequired(true)
      .addChoices(
        { name: "Rank-based Cut (e.g., Top 8)", value: "rank" },
        {
          name: "Point-based Cut (e.g., all players with 21+ pts)",
          value: "points",
        }
      )
  )
  .addIntegerOption((option) =>
    option
      .setName("pointsrequired")
      .setDescription(
        "Optional: Manually set points required for a point-based cut."
      )
      .setRequired(false)
      .setMinValue(1)
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("The title of the tournament.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("description")
      .setDescription("A description for the tournament.")
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const organizerId = interaction.user.id;
  const serverId = interaction.guild.id;
  const auraCost = interaction.options.getInteger("aura");
  const prizeMode = interaction.options.getString("prizemode");
  const title = interaction.options.getString("title");
  const description = interaction.options.getString("description");
  const cutType = interaction.options.getString("cuttype");
  const pointsRequired = interaction.options.getInteger("pointsrequired");

  // Initialize services
  const userService = new UserService();
  const tournamentService = new TournamentService(userService);

  try {
    // Check if the organizer is a registered user in the bot's system
    const organizerUser = await userService.findOrCreateUser(
      organizerId,
      interaction.user.tag
    );
    if (!organizerUser) {
      await interaction.editReply(
        "You need to be registered with the bot to create a tournament. Use `/init` if you haven't already."
      );
      return;
    }

    // Create the tournament using the service
    const newTournament = await tournamentService.createTournament(
      serverId,
      organizerId,
      auraCost,
      prizeMode,
      title,
      description,
      cutType,
      pointsRequired
    );

    // Create success embed
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(newTournament.title || "🏆 Tournament Created! 🏆")
      .setDescription(
        newTournament.description ||
          `A new tournament has been set up. Let the games begin (soon)!`
      )
      .addFields(
        {
          name: "Tournament ID",
          value: `\`${newTournament.tournamentId}\``,
          inline: true,
        },
        { name: "Organizer", value: `<@${organizerId}>`, inline: true },
        {
          name: "Aura Cost to Join",
          value: `💰 ${auraCost} Aura`,
          inline: true,
        },
        {
          name: "Prize Mode",
          value:
            prizeMode === "all" ? "Winner Takes All" : "Proportional Spread",
          inline: true,
        },
        {
          name: "Cut Type",
          value:
            cutType === "rank"
              ? "Rank-based"
              : `Point-based ${
                  pointsRequired ? `(${pointsRequired} pts)` : "(Auto)"
                }`,
        },
        {
          name: "Status",
          value: "🔔 Pending (Waiting for players)",
          inline: true,
        }
      )
      .setFooter({ text: "Use /join <tournament_id> to enter!" })
      .setTimestamp();

    // Send the reply to the channel where the command was used
    await interaction.followUp({ embeds: [embed], ephemeral: false }); // Not ephemeral so everyone can see
  } catch (error) {
    console.error("Error creating tournament:", error);
    await interaction.editReply({
      content: `Error: ${
        error.message ||
        "There was an error creating the tournament. Please try again later."
      }`,
    });
  }
}
