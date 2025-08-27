import { Schema, model } from 'mongoose';

const participantSchema = new Schema({
    userId: { type: String, required: true },
    discordTag: { type: String, required: true },
    // usernameShowdown: { type: String } // Optional, if needed later
}, { _id: false });

const tournamentSchema = new Schema({
    tournamentId: {
        type: String,
        required: true,
        unique: true,
        minlength: 6,
        maxlength: 6
    },
    serverId: {
        type: String,
        required: true
    },
    organizerId: {
        type: String,
        required: true
    },
    auraCost: {
        type: Number,
        required: true,
        default: 0
    },
    prizeMode: {
        type: String,
        enum: ['all', 'spread'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'finished', 'cancelled'], // Added cancelled
        default: 'pending',
        required: true
    },
    participants: [participantSchema],
    // We will create PlayerStats separately to keep this schema cleaner
    // and allow for easier querying of player-specific tournament data.
    config: {
        numSwissRounds: { type: Number },
        topCutSize: { type: Number },
        cutType: {
            type: String,
            enum: ['rank', 'points'],
        },
        pointsRequired: {
            type: Number,
            default: null
        }
    },
    currentRound: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Tournament = model('Tournament', tournamentSchema);

export default Tournament;
