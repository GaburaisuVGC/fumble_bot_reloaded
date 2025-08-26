import { SlashCommandBuilder } from "discord.js";
import FumbleClutchService from "../services/fumbleClutch/FumbleClutchService.js";
import UserService from "../services/user/UserService.js";

// Create service instances
const userService = new UserService();
const fumbleClutchService = new FumbleClutchService(userService);

export const data = new SlashCommandBuilder()
  .setName("fumble")
  .setDescription("Creates a fumble for a person")
  .addStringOption((option) =>
    option
      .setName("context")
      .setDescription("Context of the fumble")
      .setMaxLength(256)
      .setRequired(true)
  );

export async function execute(interaction) {
  const target = interaction.user;
  const context = interaction.options.getString("context") || "No context provided.";

  // Create the initial fumble embed
  const fumbleEmbed = fumbleClutchService.createFumbleEmbed(
    interaction.user.username,
    context,
    target.displayAvatarURL({ dynamic: true })
  );

  // Send the message and wait for the response
  await interaction.reply({
    embeds: [fumbleEmbed],
    fetchReply: true,
  });

  // Wait for the bot's response before reacting
  const message = await interaction.fetchReply();
  message.react("👍");
  message.react("👎");

  const filter = (reaction, user) => {
    return ["👍", "👎"].includes(reaction.emoji.name) && !user.bot && user.id !== interaction.user.id;
  };

  const collector = message.createReactionCollector({
    filter,
    time: 896000, // About 15 minutes
    dispose: true,
  });

  let votes = [];

  collector.on("collect", (reaction, u) => {
    votes.push({ userId: u.id, emoji: reaction.emoji.name, ts: Date.now() });
    console.log(votes);
  });

  collector.on("remove", (reaction, u) => {
    votes = votes.filter(v => !(v.userId === u.id && v.emoji === reaction.emoji.name));
    console.log(votes);
  });

  collector.on("end", async () => {
    try {
      // Process the fumble using the service
      const result = await fumbleClutchService.processFumble(
        target.id,
        target.username,
        context,
        votes,
        interaction.createdTimestamp
      );

      // Create the result embed
      const resultEmbed = fumbleClutchService.createFumbleResultEmbed(
        target.username,
        context,
        target.displayAvatarURL({ dynamic: true }),
        result.stats,
        result.initialElo,
        result.finalElo,
        result.rankChange
      );

      // Update the message with the result
      await interaction.editReply({ embeds: [resultEmbed] });
    } catch (error) {
      console.error("Error editing response:", error);
      try {
        await interaction.editReply(
          "An error occurred while processing your fumble."
        );
      } catch (editError) {
        console.error("Error editing error response:", editError);
      }
    }
  });
}