import { Schema, model } from 'mongoose';

const playerIdentifierSchema = new Schema({
    userId: { type: String, required: true },
    discordTag: { type: String, required: true }
}, { _id: false });

const matchSchema = new Schema({
    matchId: { // Unique within a tournament, e.g., 001, 002 ... 101
        type: String,
        required: true
    },
    tournament: { // Reference to the Tournament document
        type: Schema.Types.ObjectId,
        ref: 'Tournament',
        required: true
    },
    roundNumber: {
        type: Number,
        required: true
    },
    isTopCutRound: { // To distinguish between Swiss and Top Cut rounds
        type: Boolean,
        default: false
    },
    player1: { // Player 1 can also be null in case of a BYE for player2
        type: playerIdentifierSchema,
        default: null
    },
    player2: {
        type: playerIdentifierSchema,
        default: null // If player2 is null, it's a BYE for player1
    },
    winnerId: { // Discord User ID of the winner
        type: String,
        default: null
    },
    // loserId is implicitly the other player if not a draw and winnerId is set
    isDraw: {
        type: Boolean,
        default: false
    },
    reported: {
        type: Boolean,
        default: false
    },
    // Optional: if you want to store game scores like 2-1
    // scoreP1: { type: Number },
    // scoreP2: { type: Number },

    // Fields to store PlayerStats state before this match was reported, for round reset purposes
    player1StatsBeforeReport: {
        wins: Number,
        losses: Number,
        draws: Number,
        score: Number,
        // Potentially add OWP/OOWP if those are heavily affected and hard to recalculate,
        // but for now, focusing on primary stats.
    },
    player2StatsBeforeReport: {
        wins: Number,
        losses: Number,
        draws: Number,
        score: Number,
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster querying of matches within a tournament
matchSchema.index({ tournament: 1, matchId: 1 }, { unique: true });
matchSchema.index({ tournament: 1, roundNumber: 1 });

const Match = model('Match', matchSchema);

export default Match;
