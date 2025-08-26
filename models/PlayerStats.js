import { Schema, model } from 'mongoose';

const playerStatsSchema = new Schema({
    tournament: { // Reference to the Tournament document
        type: Schema.Types.ObjectId,
        ref: 'Tournament',
        required: true
    },
    userId: { // Discord User ID
        type: String,
        required: true
    },
    discordTag: { // Discord Tag, e.g., user#1234
        type: String,
        required: true
    },
    score: { // Tournament points
        type: Number,
        default: 0
    },
    wins: {
        type: Number,
        default: 0
    },
    losses: {
        type: Number,
        default: 0
    },
    draws: {
        type: Number,
        default: 0
    },
    matchesPlayed: [{ // List of Match ObjectIds
        type: Schema.Types.ObjectId,
        ref: 'Match'
    }],
    opponents: [{ // List of opponent UserIDs (Discord IDs)
        type: String
    }],
    tiebreaker1_OWP: { // Opponent Win Percentage (calculated at end of Swiss/each round)
        type: Number,
        default: 0
    },
    tiebreaker2_OOWP: { // Opponent's Opponent Win Percentage (calculated at end of Swiss/each round)
        type: Number,
        default: 0
    },
    receivedByeInRound: { // Round number in which a bye was received, 0 if no bye
        type: Number,
        default: 0
    },
    activeInTournament: { // To mark if a player dropped or is still playing
        type: Boolean,
        default: true
    },
    initialSeed: { // Seed going into top cut, based on Swiss performance
        type: Number
    },
    finalRank: { // Final rank after tournament completion
        type: Number
    },
    eliminationStage: { // Records the stage a player was eliminated in top cut (e.g., 'QF', 'SF')
        type: String,
        default: null
    }
});

// Index for faster querying of player stats within a tournament
playerStatsSchema.index({ tournament: 1, userId: 1 }, { unique: true });
playerStatsSchema.index({ tournament: 1, score: -1, tiebreaker1_OWP: -1, tiebreaker2_OOWP: -1 }); // For standings

const PlayerStats = model('PlayerStats', playerStatsSchema);

export default PlayerStats;
