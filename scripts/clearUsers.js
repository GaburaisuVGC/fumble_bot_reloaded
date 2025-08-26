import mongoose from 'mongoose';
import { config } from 'dotenv';
import Server from '../models/Server.js';

config();

async function clearRegisteredUsers() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');
        const result = await Server.updateMany({}, { $set: { registeredUsers: [] } });

        console.log(`Cleared registeredUsers for ${result.modifiedCount} servers.`);

        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    } catch (error) {
        console.error('Error clearing registeredUsers:', error);
        process.exit(1);
    }
}

clearRegisteredUsers();
