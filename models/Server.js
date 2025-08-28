import { Schema, model } from "mongoose";
import { config } from 'dotenv';
config();

const userSchema = new Schema({
  username: { type: String, required: true },
  elo: { type: Number, required: true },
  gxe: { type: Number, required: true },
  discordId: { type: String, required: true },
});

const serverSchema = new Schema({
  discordId: { type: String, required: true, unique: true },
  registeredUsers: [userSchema],
  showdownRoom: { type: String },
  organizers: [{ type: String }],
});

const Server = model("Server", serverSchema);

export default Server;

// Utility function to check if a member is an organizer
export async function isOrganizer(guildId, userId) {
  const server = await Server.findOne({ discordId: guildId });
  if (!server || !server.organizers) return false;
  return server.organizers.includes(userId);
}

// Utility function to check if a member is the bot owner
export function isBotOwner(userId) {
    return userId === process.env.BOT_ADMIN_ID;
}