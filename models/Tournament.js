import { Schema, model } from 'mongoose';

const participantSchema = new Schema({
    userId: { type: String, required: true },
    discordTag: { type: String, required: true },
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
    title: {
        type: String,
        default: 'Untitled Tournament'
    },
    description: {
        type: String,
        default: ''
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
        enum: ['pending', 'active', 'finished', 'cancelled'],
        default: 'pending',
        required: true
    },
    participants: [participantSchema],
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
        },
        isTwoPhase: {
            type: Boolean,
            default: false
        },
        phase1Rounds: {
            type: Number,
            default: 0
        },
        phase2Rounds: {
            type: Number,
            default: 0
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
