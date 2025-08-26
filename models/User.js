import { Schema, model } from 'mongoose';

const userSchema = new Schema({
    discordId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    rank: {
        type: String,
        default: 'Iron I'
    },
    elo: {
        type: Number,
        default: 1000
    },
    fumbles: {
        type: Number,
        default: 0
    },
    clutches: {
        type: Number,
        default: 0
    },
    peakElo: {
        type: Number,
        default: 1000
    },
    lowestElo: {
        type: Number,
        default: 1000
    },
    fumbleCombo: {
        type: Number,
        default: 0
    },
    clutchCombo: {
        type: Number,
        default: 0
    },
    comboMultiplier: {
        type: Number,
        default: 1
    },
    auraGainedTournaments: { // Total Aura (elo) gained from tournament prizes
        type: Number,
        default: 0
    },
    auraSpentTournaments: { // Total Aura (elo) spent on tournament entry fees
        type: Number,
        default: 0
    },
    tournamentWins: { // Number of tournaments won (1st place)
        type: Number,
        default: 0
    },
    tournamentParticipations: { // Number of tournaments participated in
        type: Number,
        default: 0
    },
    totalWins: { // Total match wins across all tournaments
        type: Number,
        default: 0
    },
    totalLosses: { // Total match losses across all tournaments
        type: Number,
        default: 0
    },
    playedOnServers: [{ // Array of server IDs the user has played on
        type: String
    }]
});

// Index for playedOnServers to speed up leaderboard queries for a specific server
userSchema.index({ playedOnServers: 1 });

const User = model('User', userSchema);

export default User;
