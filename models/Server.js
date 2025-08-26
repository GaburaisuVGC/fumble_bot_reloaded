import { Schema, model } from 'mongoose';

const userSchema = new Schema({
    username: { type: String, required: true },
    elo: { type: Number, required: true },
    gxe: { type: Number, required: true }
});

const serverSchema = new Schema({
    discordId: { type: String, required: true, unique: true },
    registeredUsers: [userSchema],
    showdownRoom: { type: String }
});

const Server = model('Server', serverSchema);

export default Server;
